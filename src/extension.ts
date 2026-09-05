// extension.ts — VS Code 扩展入口：注册 SCMCU 命令
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { buildProject } from './build';
import { findCompilerDir } from './compiler';
import { findScwFile, parseScw, writeScwDevice, listChips, loadChipParams, writeScwConfig, normalizeConfigWordsCore } from './chip';
import { showHardwareOptions } from './webview/hardwareOptions';
import { showSourceManager } from './webview/sourceManager';
import { findScxFiles, patchScxConfigWords } from './scx';
import { detectProgrammers } from './programmer';
import { flashScx } from './flash';

// 插件是否已加载（保证「SCMCU: 启动」命令幂等，不重复注册）
let scmcuLoaded = false;
// 全局输出通道，供编译等命令处理器使用（在 startScmcu 中初始化）
let channel!: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // 始终注册「启动」命令：即使本次因无 .scw 且用户选择不加载，也可稍后手动启用
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.startup', () => startScmcu(context)));

    const root = getWorkspaceRoot();
    if (root && !findScwFile(root)) {
        // 找不到 .scw：按 scmcu.noScwBehavior 决定（skip=不加载 / load=直接加载 / prompt=弹窗）
        const ok = await promptNoScw();
        if (!ok) {
            return; // 本次不加载；可运行「SCMCU: 启动」命令启用
        }
    }
    startScmcu(context);
}

// 加载 SCMCU 插件功能：注册全部命令、状态栏等。幂等，重复调用不会重复注册。
function startScmcu(context: vscode.ExtensionContext): void {
    if (scmcuLoaded) {
        vscode.window.showInformationMessage('SCMCU 插件功能已加载');
        return;
    }
    scmcuLoaded = true;
    channel = vscode.window.createOutputChannel('SCMCU');
    context.subscriptions.push(channel);

    // ---- 编译 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.build', async () => {
        const root = workspaceRoot();
        if (!root) return;
        channel.clear();
        channel.show(true);
        await buildProject(root, channel);
    }));

    // ---- 一键编译下载：编译成功后调用 SCMCU Writer 烧录 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.buildAndFlash', async () => {
        const root = workspaceRoot();
        if (!root) return;
        channel.clear();
        channel.show(true);
        const built = await buildProject(root, channel);
        if (!built) return;
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const buildDir = cfg.get<string>('buildDir', 'build');
        const outName = cfg.get<string>('outputName', 'SCMCU_Project');
        const scxPath = path.join(root, buildDir, outName + '.scx');
        if (!fs.existsSync(scxPath)) {
            vscode.window.showErrorMessage('未找到烧录文件（编译应已生成 .scx）: ' + scxPath);
            return;
        }
        // 脱机烧写次数上限：0=无限（默认），>0=限次。不可强制最小 1，否则会锁成“烧一次即耗尽”。
        const count = cfg.get<number>('flashCount', 0) || 0;
        const helper = context.asAbsolutePath(path.join('flash', 'ScmcuFlashHelper.exe'));
        const r = await flashScx(scxPath, helper, channel, count, false);
        if (r.ok) {
            vscode.window.showInformationMessage('一键下载完成: ' + path.basename(scxPath));
        } else {
            vscode.window.showErrorMessage('下载失败: ' + r.message);
        }
    }));

    // ---- 硬件选项 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.hardwareOptions', () => {
        const root = workspaceRoot();
        if (!root) return;
        showHardwareOptions(context, root, channel);
    }));

    // ---- 选择芯片 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.selectChip', async () => {
        const root = getWorkspaceRoot();
        if (!root) { vscode.window.showWarningMessage('请先打开包含 .scw 工程的文件夹'); return; }
        const scw = findScwFile(root);
        if (!scw) { vscode.window.showErrorMessage('未找到 .scw 工程文件'); return; }
        const comp = findCompilerDir();
        if (!comp) { vscode.window.showErrorMessage('未找到编译器，请先配置'); return; }
        const chips = listChips(comp.idePath);
        if (chips.length === 0) { vscode.window.showErrorMessage(`未扫描到芯片列表: ${path.join(comp.idePath, 'mcu', 'config')}`); return; }
        const current = parseScw(scw).device;
        const pick = await vscode.window.showQuickPick(
            chips.map(c => ({ label: c, description: c === current ? '当前' : undefined })),
            { placeHolder: `当前芯片: ${current}，选择新芯片` },
        );
        if (!pick) return;
        writeScwDevice(scw, pick.label);
        updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus);
        vscode.window.showInformationMessage(`芯片已切换为 ${pick.label}，建议重新打开"硬件选项"确认配置`);
    }));

    // ---- 配置编译器目录 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.configureCompiler', async () => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const cur = cfg.get<string>('idePath', '') || '';
        const val = await vscode.window.showInputBox({
            prompt: '输入 SCMCU_IDE 安装根目录（应包含 mcu\\config 和 data\\bin\\picc.exe）',
            value: cur,
            placeHolder: '如 C:\\Program Files (x86)\\SCMCU_IDE_V2.00.17',
        });
        if (val === undefined || val.trim() === '') return;
        const ide = val.trim().replace(/\\+$/, '');
        const bin = path.join(ide, 'data', 'bin');
        if (fs.existsSync(path.join(bin, 'picc.exe')) && fs.existsSync(path.join(ide, 'mcu'))) {
            await cfg.update('compilerPath', bin, vscode.ConfigurationTarget.Global);
            await cfg.update('idePath', ide, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`编译器已配置: ${bin}`);
        } else {
            vscode.window.showWarningMessage('该目录下未找到 data\\bin\\picc.exe 或 mcu 目录，请确认路径');
        }
    }));

    // ---- 自动检测编译器 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.detectCompiler', async () => {
        const found = findCompilerDir();
        if (found) {
            const cfg = vscode.workspace.getConfiguration('scmcu');
            await cfg.update('compilerPath', found.binDir, vscode.ConfigurationTarget.Global);
            await cfg.update('idePath', found.idePath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`自动检测到编译器: ${found.binDir}`);
        } else {
            vscode.window.showErrorMessage('未自动检测到编译器，请用 "SCMCU: 配置编译器目录" 手动指定');
        }
    }));

    // ---- 源文件管理 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.manageSources', () => {
        const root = getWorkspaceRoot();
        if (!root) { vscode.window.showWarningMessage('请先打开包含 .scw 工程的文件夹'); return; }
        showSourceManager(context, root, channel);
    }));

    // ---- 脱离 .scw：设置芯片型号 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.setDevice', async () => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const cur = cfg.get<string>('device', '') || '';
        const val = await vscode.window.showInputBox({
            prompt: '脱离 .scw 编译时使用的芯片型号（如 SC8F052A04）',
            value: cur,
            placeHolder: '如 SC8F052A04',
        });
        if (val === undefined) return;
        const dev = val.trim();
        if (dev === '') { vscode.window.showWarningMessage('芯片型号不能为空'); return; }
        await cfg.update('device', dev, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`已设置 scmcu.device = ${dev}（写入工作区设置）`);
        updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus);
    }));

    // ---- 脱离 .scw：设置配置字 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.setConfigWords', async () => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const cur = (cfg.get<string[]>('configWords', []) || []).join(', ');
        const val = await vscode.window.showInputBox({
            prompt: '脱离 .scw 编译时的 4 个配置字（十六进制，逗号分隔，如 0x1FFF, 0x3FFF, 0x3FFF, 0x3FFF）',
            value: cur,
            placeHolder: '0x1FFF, 0x3FFF, 0x3FFF, 0x3FFF',
        });
        if (val === undefined) return;
        const parts = val.split(',').map(s => s.trim()).filter(s => s.length > 0);
        await cfg.update('configWords', parts, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(parts.length
            ? `已设置 scmcu.configWords = [${parts.join(', ')}]`
            : '已清空 scmcu.configWords（脱离 .scw 将用默认未编程配置字，编译时给出警告）');
    }));

    // ---- 规范化配置字（对齐芯片规范，修复"换芯片串配置字"导致的高位/隐藏位错误） ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.fixConfigWords', async () => {
        await normalizeConfigWords();
    }));

    // ---- 状态栏：芯片型号（点击切换）+ 芯片设置 + 构建 + 源文件 ----
    const chipStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    chipStatus.command = 'scmcu.selectChip';
    context.subscriptions.push(chipStatus);
    const cfgStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    cfgStatus.command = 'scmcu.hardwareOptions';
    context.subscriptions.push(cfgStatus);
    const buildStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
    buildStatus.command = 'scmcu.build';
    context.subscriptions.push(buildStatus);
    const flashStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
    flashStatus.command = 'scmcu.buildAndFlash';
    flashStatus.text = '$(zap) 编译下载';
    flashStatus.tooltip = '一键编译 + 烧录到 SCMCU 编程器（需连接编程器并放入芯片）';
    context.subscriptions.push(flashStatus);
    flashStatusItem = flashStatus;
    const srcStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    srcStatus.command = 'scmcu.manageSources';
    context.subscriptions.push(srcStatus);

    // ---- 编程器识别：底栏右侧显示当前连接的 SCMCU 编程器型号（点击立即刷新）----
    const progStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    progStatus.command = 'scmcu.refreshProgrammer';
    context.subscriptions.push(progStatus);
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.refreshProgrammer', () => refreshProgrammerStatus(progStatus, true)));
    startProgrammerWatcher(context, progStatus);

    updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus);
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus)));

    // 无 .scw（脱离 IDE 工程）时，加载后自动执行一次配置字规范化（幂等，详见 autoNormalizeConfigWords）
    void autoNormalizeConfigWords(context);
}

// 找不到 .scw 时的提示：自定义 webview 通知（真实复选框 + 单个「加载」按钮 + 20 秒无操作自动关闭）
// 返回 true=加载插件，false=不加载。behavior=load/skip 时直接返回，不弹窗。
// 找不到 .scw 时的提示：原生右下角通知（黑框），单个「加载」按钮，无复选框、无倒计时。
// 通知自动消失或用户关闭后选择为空 → 本次不加载。behavior=load/skip 时直接决定，不弹窗。
function promptNoScw(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const behavior = cfg.get<string>('noScwBehavior', 'prompt');
        if (behavior === 'skip') { resolve(false); return; }
        if (behavior === 'load') { resolve(true); return; }
        // 原生通知（右下角黑框）：仅一个「加载」按钮；超时/关闭(Esc)视为本次不加载
        vscode.window.showWarningMessage(
            '未找到 .scw 工程文件，当前文件夹可能不是 SCMCU 工程。是否加载 SCMCU 插件功能？',
            '加载'
        ).then((choice) => {
            resolve(choice === '加载');
        });
    });
}

// 状态栏刷新：显示当前工程 .scw 的芯片型号；脱离 .scw 模式则显示设置中的型号并仅提供构建
function updateStatusBar(chipStatus: vscode.StatusBarItem, cfgStatus: vscode.StatusBarItem, buildStatus: vscode.StatusBarItem, srcStatus: vscode.StatusBarItem): void {
    const root = getWorkspaceRoot();
    const cfg = vscode.workspace.getConfiguration('scmcu');
    let device = '';
    let scwMode = false;
    if (root) {
        const scw = findScwFile(root);
        if (scw) {
            device = parseScw(scw).device;
        } else {
            scwMode = true;
            device = cfg.get<string>('device', '') || '';
        }
    }
    if (device) {
        chipStatus.text = `$(chip) ${device}`;
        chipStatus.command = scwMode ? 'scmcu.setDevice' : 'scmcu.selectChip';
        chipStatus.tooltip = scwMode ? '点击更换芯片型号 (脱离 .scw 模式)' : '点击切换芯片型号';
        chipStatus.show();
        buildStatus.text = '$(debug-start) 构建';
        buildStatus.tooltip = scwMode ? '脱离 .scw 编译：源文件自动扫描或取自 scmcu.sourceFiles，配置字取自 scmcu.configWords' : '编译工程并生成 .hex + .scx（带芯片设置配置）';
        buildStatus.show();
        if (flashStatusItem) flashStatusItem.show();
        // 芯片设置 + 源文件按钮在两种模式下都可用：
        //   scw 模式 → 读写 .scw 文件
        //   scw-less 模式 → 读写 scmcu.configWords / scmcu.sourceFiles 工作区设置
        cfgStatus.text = '$(settings-gear) 芯片设置';
        cfgStatus.tooltip = scwMode ? '配置硬件选项并写入 scmcu.configWords' : '配置看门狗/低压复位/时钟/配置字，保存后写入烧录文件';
        cfgStatus.show();
        srcStatus.text = '$(file-directory) 源文件';
        srcStatus.tooltip = scwMode ? '管理 scmcu.sourceFiles（脱离 .scw 模式）' : '管理要编译的源文件（添加 / 删除 / 排序）';
        srcStatus.show();
    } else {
        chipStatus.text = '$(chip) SCMCU';
        chipStatus.tooltip = root ? (scwMode ? '未配置 scmcu.device，无法脱离 .scw 编译' : '未找到 .scw 工程文件') : '未打开工程文件夹';
        chipStatus.show();
        cfgStatus.hide();
        buildStatus.hide();
        if (flashStatusItem) flashStatusItem.hide();
        srcStatus.hide();
    }
}

// 规范化配置字：按当前芯片模板，用"当前选择 + 未编程值"重建配置字并写回，
// 修复基底串了其它芯片（如 SC8F072 的 FAEF 被带入 SC8F052）或高位残留 F 的问题。
async function normalizeConfigWords(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showWarningMessage('请先打开工程文件夹'); return; }
    const cfg = vscode.workspace.getConfiguration('scmcu');
    const scw = findScwFile(root);
    let device = '';
    let mode: 'scw' | 'scwless';
    let scwPath: string | null = null;
    if (scw) {
        mode = 'scw'; scwPath = scw;
        device = parseScw(scw).device;
    } else {
        mode = 'scwless';
        device = cfg.get<string>('device', '') || '';
    }
    if (!device) { vscode.window.showWarningMessage('无法确定芯片型号（无 .scw 且未设置 scmcu.device）'); return; }

    const comp = findCompilerDir();
    if (!comp) { vscode.window.showErrorMessage('未找到编译器，请先配置 SCMCU_IDE 路径'); return; }
    const cfgPath = path.join(comp.idePath, 'mcu', 'config', device + '.cfg');
    if (!fs.existsSync(cfgPath)) { vscode.window.showErrorMessage(`未找到芯片配置模板: ${cfgPath}`); return; }

    const hexmcu = loadChipParams(comp.idePath, device).hexmcu;

    // 当前配置字基底
    let base: number[];
    if (mode === 'scw') {
        const ws = parseScw(scwPath!).configWords;
        base = ws.length >= 2 ? ws.slice(0, 4) : [hexmcu, hexmcu, hexmcu, hexmcu];
    } else {
        const cw = (cfg.get<string[]>('configWords', []) || []).filter(s => s && s.trim());
        base = cw.length ? cw.map(s => parseInt(s, 16) & 0xFFFF) : [hexmcu, hexmcu, hexmcu, hexmcu];
    }

    // 核心规范化计算：见 chip.ts normalizeConfigWordsCore。
    // 保留模板已定义位，仅复位未定义固定位并按位宽清高位，幂等。
    const resolved = normalizeConfigWordsCore(base, device, comp.idePath);
    const before = base.map(x => x.toString(16).toUpperCase().padStart(4, '0')).join(',');
    const after = resolved.map(x => x.toString(16).toUpperCase().padStart(4, '0')).join(',');

    const buildDir = cfg.get<string>('buildDir', 'build');
    const synced: string[] = [];
    if (mode === 'scw') {
        writeScwConfig(scwPath!, resolved);
        for (const s of findScxFiles(root, buildDir)) {
            if (patchScxConfigWords(s, device, resolved)) synced.push(path.basename(s));
        }
        if (channel) channel.appendLine(`[SCMCU] 规范化配置字: ${before} -> ${after} (${path.basename(scwPath!)})`);
        vscode.window.showInformationMessage(`已规范化配置字: ${before} -> ${after}${synced.length ? '，并同步 ' + synced.join(', ') : ''}`);
    } else {
        const hexStrs = resolved.map(x => '0x' + x.toString(16).toUpperCase().padStart(4, '0'));
        await cfg.update('configWords', hexStrs, vscode.ConfigurationTarget.Workspace);
        for (const s of findScxFiles(root, buildDir)) {
            if (patchScxConfigWords(s, device, resolved)) synced.push(path.basename(s));
        }
        if (channel) channel.appendLine(`[SCMCU] 规范化配置字: ${before} -> ${after} (scmcu.configWords)`);
        vscode.window.showInformationMessage(`已规范化配置字: ${before} -> ${after}（已写入 scmcu.configWords${synced.length ? '，并同步 ' + synced.join(', ') : ''}）`);
    }
}

// 自动规范化：检测到工程无 SCMCU IDE 生成的 .scw（脱离 .scw 模式）时自动执行一次配置字规范化。
// 触发条件（全部满足）：无 .scw && 已设 scmcu.device && 已手填 scmcu.configWords &&
//                     编译器已配置 && 有芯片 cfg 模板。
// 行为：仅当规范化结果有变化时才写回 scmcu.configWords（并尽力同步 build 目录 .scx），
//      并弹一次信息提示；已规范（无变化）时静默跳过，不写回不打扰。
// 只自动执行一次：context.workspaceState 记录标记，同工作区后续重开不再自动执行（可手动
//      用「SCMCU: 规范化配置字」）。任何异常静默记日志，避免打断启动。
export async function autoNormalizeConfigWords(context: vscode.ExtensionContext): Promise<void> {
    try {
        const root = getWorkspaceRoot();
        if (!root) return;
        if (findScwFile(root)) return; // 有 .scw = 正常 IDE 工程模式，配置字由 IDE/.scw 维护，不自动改
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const device = cfg.get<string>('device', '') || '';
        if (!device) return; // 未设置芯片型号，无从规范
        const cw = (cfg.get<string[]>('configWords', []) || []).filter(s => s && s.trim());
        if (cw.length === 0) return; // 未手填配置字（用默认未编程值），无串芯片风险，无需规范
        const onceKey = 'configWordsAutoNormalized';
        if (context.workspaceState.get<boolean>(onceKey)) return; // 本工作区只自动执行一次
        const comp = findCompilerDir();
        if (!comp) return; // 编译器未配置：本次跳过，配置后重开窗口会再尝试
        const cfgPath = path.join(comp.idePath, 'mcu', 'config', device + '.cfg');
        if (!fs.existsSync(cfgPath)) return; // 无芯片 cfg 模板，跳过
        const base = cw.map(s => parseInt(s, 16) & 0xFFFF);
        const resolved = normalizeConfigWordsCore(base, device, comp.idePath);
        await context.workspaceState.update(onceKey, true); // 无论是否变化，自动执行仅此一次
        const changed = resolved.some((v, i) => v !== base[i]);
        if (!changed) return; // 已规范化，无变化：不写回、不提示
        const hexStrs = resolved.map(x => '0x' + x.toString(16).toUpperCase().padStart(4, '0'));
        await cfg.update('configWords', hexStrs, vscode.ConfigurationTarget.Workspace);
        const fmt = (arr: number[]) => arr.map(x => x.toString(16).toUpperCase().padStart(4, '0')).join(',');
        const buildDir = cfg.get<string>('buildDir', 'build');
        const synced: string[] = [];
        for (const s of findScxFiles(root, buildDir)) {
            if (patchScxConfigWords(s, device, resolved)) synced.push(path.basename(s));
        }
        if (channel) channel.appendLine(`[SCMCU] 自动规范化配置字（无 .scw）: ${fmt(base)} -> ${fmt(resolved)}${synced.length ? '，同步 ' + synced.join(', ') : ''}`);
        vscode.window.showInformationMessage(`检测到无 .scw（脱离 IDE 工程），已自动规范化配置字: ${fmt(base)} -> ${fmt(resolved)}${synced.length ? '（并同步 ' + synced.join(', ') + '）' : ''}`);
    } catch (e) {
        if (channel) channel.appendLine(`[SCMCU] 自动规范化配置字失败: ${e}`);
    }
}

// ---- 编程器识别（Windows USB HID，VID 0x1209）----
// 型号/PID 表来自官方 SCMCU Writer（Writer.Core.dll）反编译；识别逻辑见 src/programmer.ts。
// 每次枚举 USB 设备约 1s，故仅在窗口聚焦时轮询、失焦停表，避免后台窗口持续空耗 CPU。
const PROGRAMMER_POLL_MS = 5000;
let flashStatusItem: vscode.StatusBarItem | undefined; // 一键编译下载按钮（updateStatusBar 内同步显隐）
let progTimer: NodeJS.Timeout | undefined;
let progPollOn = false;
let progBusy = false;
let progLastText = '';

function startProgrammerWatcher(context: vscode.ExtensionContext, item: vscode.StatusBarItem): void {
    if (process.platform !== 'win32') {
        item.text = '$(circuit-board) 编程器: 不支持';
        item.tooltip = 'SCMCU 编程器识别仅支持 Windows（USB HID，VID 0x1209）';
        item.show();
        return;
    }
    item.text = '$(circuit-board) 编程器: 检测中…';
    item.tooltip = '正在检测 SCMCU 编程器…（点击立即刷新）';
    item.show();
    const sync = (focused: boolean): void => {
        if (focused) {
            if (!progPollOn) {
                progPollOn = true;
                progTimer = setInterval(() => { void refreshProgrammerStatus(item, false); }, PROGRAMMER_POLL_MS);
            }
        } else {
            progPollOn = false;
            if (progTimer) { clearInterval(progTimer); progTimer = undefined; }
        }
    };
    sync(vscode.window.state.focused);
    context.subscriptions.push(vscode.window.onDidChangeWindowState((s) => sync(s.focused)));
    void refreshProgrammerStatus(item, false); // 首查
}

async function refreshProgrammerStatus(item: vscode.StatusBarItem, verbose: boolean): Promise<void> {
    if (progBusy) return;
    progBusy = true;
    try {
        const devs = await detectProgrammers();
        const one = devs.map(d => `${d.name} (PID 0x${d.pidHex}${d.mode === 'bootloader' ? '，升级模式' : ''})`).join('、');
        let text: string;
        let tip: string;
        if (devs.length === 0) {
            text = '$(circuit-board) 编程器: 未连接';
            tip = '未检测到 SCMCU 编程器（USB VID 0x1209）。\n支持的型号：WRITER8 LITE / WRITER V8 / WRITER V8 PRO / ICE8 PRO\n点击立即刷新';
        } else {
            text = '$(circuit-board) ' + devs.map(d => d.mode === 'bootloader' ? `${d.name} (Boot)` : d.name).join('、');
            tip = devs.map(d => `已检测到 SCMCU 编程器：${d.name}\nUSB VID 0x1209 / PID 0x${d.pidHex}${d.mode === 'bootloader' ? '\n注意：编程器处于升级(bootloader)模式，请用 Writer 的升级功能刷写固件' : ''}`).join('\n\n') + '\n点击立即刷新';
        }
        if (progLastText !== text) { // 内容变化才刷新状态栏，避免闪烁
            progLastText = text;
            item.text = text;
            item.tooltip = tip;
        }
        if (verbose) {
            if (channel) channel.appendLine(`[SCMCU] 编程器检测: ${one || '未连接'}`);
            vscode.window.showInformationMessage(devs.length ? `检测到编程器: ${one}` : '未检测到 SCMCU 编程器（USB VID 0x1209）');
        }
    } catch (e) {
        progLastText = '';
        item.text = '$(circuit-board) 编程器: 检测失败';
        item.tooltip = `编程器检测出错: ${e}\n点击重试`;
        if (channel) channel.appendLine(`[SCMCU] 编程器检测失败: ${e}`);
        if (verbose) vscode.window.showErrorMessage(`编程器检测失败: ${e}`);
    } finally {
        progBusy = false;
    }
}

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function workspaceRoot(): string | undefined {
    const root = getWorkspaceRoot();
    if (!root) {
        vscode.window.showWarningMessage('请先打开包含 .scw 工程的文件夹');
        return undefined;
    }
    return root;
}

export function deactivate(): void { /* noop */ }
