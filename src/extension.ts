// extension.ts — VS Code 扩展入口：注册 SCMCU 命令
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { buildProject } from './build';
import { findCompilerDir } from './compiler';
import { findScwFile, parseScw, writeScwDevice, listChips } from './chip';
import { showHardwareOptions } from './webview/hardwareOptions';
import { showSourceManager } from './webview/sourceManager';

export function activate(context: vscode.ExtensionContext): void {
    const channel = vscode.window.createOutputChannel('SCMCU');
    context.subscriptions.push(channel);

    // ---- 编译 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.build', async () => {
        const root = workspaceRoot();
        if (!root) return;
        channel.clear();
        channel.show(true);
        await buildProject(root, channel);
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

    // ---- 状态栏：芯片型号（点击切换）+ 芯片设置 + 构建 + 源文件 ----
    const chipStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    chipStatus.command = 'scmcu.selectChip';
    context.subscriptions.push(chipStatus);
    const cfgStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    cfgStatus.command = 'scmcu.hardwareOptions';
    context.subscriptions.push(cfgStatus);
    const buildStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    buildStatus.command = 'scmcu.build';
    context.subscriptions.push(buildStatus);
    const srcStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
    srcStatus.command = 'scmcu.manageSources';
    context.subscriptions.push(srcStatus);

    updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus);
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus)));
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
        srcStatus.hide();
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
