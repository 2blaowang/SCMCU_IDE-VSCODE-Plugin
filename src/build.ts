// build.ts — 编译编排：读 .scw → 调 picc（IDE 完整参数）→ 生成 .scx + 错误诊断
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { findScwFile, parseScw, loadChipParams } from './chip';
import { findCompilerDir } from './compiler';
import { hexToScx, calcCfgChecks } from './scx';

// 编译错误/警告诊断集合（Problem 面板）
const diagCollection = vscode.languages.createDiagnosticCollection('scmcu');

export async function buildProject(workspaceRoot: string, channel: vscode.OutputChannel): Promise<boolean> {
    diagCollection.clear();
    const scw = findScwFile(workspaceRoot);
    if (!scw) { err(channel, '未找到 .scw 工程文件'); return false; }
    const info = parseScw(scw);
    if (!info.device) { err(channel, '.scw 中缺少 Device= 行'); return false; }

    const comp = findCompilerDir();
    if (!comp) {
        err(channel, '未找到编译器 (picc.exe)。请执行 "SCMCU: 配置编译器目录" 或 "SCMCU: 自动检测编译器"。');
        return false;
    }
    const params = loadChipParams(comp.idePath, info.device);
    const cfg = vscode.workspace.getConfiguration('scmcu');
    const buildDir = path.join(workspaceRoot, cfg.get<string>('buildDir', 'build'));
    const outName = cfg.get<string>('outputName', 'SCMCU_Project');
    const sourceDirsCfg = cfg.get<string[]>('sourceDirs', ['src']);
    const includeDirsCfg = cfg.get<string[]>('includeDirs', ['inc']);
    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
    const hexPath = path.join(buildDir, outName + '.hex');
    const scxPath = path.join(buildDir, outName + '.scx');

    // 按 .scw 的 SourceFile 顺序收集（顺序影响 XC8 psect 分配，必须与 IDE 一致）
    // 查找顺序：用户配置 sourceDirs → 根目录 → 常见目录
    const srcs: string[] = [];
    const missing: string[] = [];
    for (const f of info.sourceFiles) {
        const resolved = resolveSource(f, workspaceRoot, sourceDirsCfg);
        if (resolved) srcs.push(resolved);
        else missing.push(f);
    }
    if (srcs.length === 0) {
        const listed = info.sourceFiles.join(', ') || '(空)';
        err(channel, `工程中无可用源文件。.scw 的 SourceFile: ${listed}。\n` +
            `  设置项 scmcu.sourceDirs 当前为: [${sourceDirsCfg.join(', ')}]。\n` +
            `  解决：在设置里配置正确的源文件目录，或在 .scw 的 SourceFile= 行加子目录前缀（如 src\\init.c）。`);
        channel.appendLine(`[SCMCU] 缺失的 SourceFile: ${missing.join(', ')}`);
        return false;
    }
    if (missing.length > 0) {
        channel.appendLine(`[SCMCU] ⚠️ 以下 SourceFile 找不到（已跳过）: ${missing.join(', ')}`);
    }

    // 收集 include 路径：①源文件所在目录 ②用户 includeDirs ③工程根目录 ④IDE include
    const incDirs: string[] = [];
    for (const s of srcs) {
        const dir = path.dirname(s);
        if (!incDirs.includes(dir)) incDirs.push(dir);
    }
    for (const d of includeDirsCfg) {
        const full = d === '' ? workspaceRoot : path.join(workspaceRoot, d);
        if (fs.existsSync(full) && !incDirs.includes(full)) incDirs.push(full);
    }
    if (!incDirs.includes(workspaceRoot)) incDirs.push(workspaceRoot);
    incDirs.push(path.join(comp.idePath, 'data', 'include'));

    // 错误输出格式化为可解析格式（不影响 hex/scx 产物）
    // 注意: 路径必须打头(路径:行:列)，VS Code 输出面板才能自动识别为 Ctrl+点击链接
    const errFmt = '%f:%l:%c: Error[%n] %s';
    const warnFmt = '%f:%l:%c: Warning[%n] %s';
    const msgFmt = '%f:%l:%c: Info[%n] %s';

    const args = [
        `--chip=${info.device}`,
        '--fill=0xFFFF', '--output=intel',
        '-D__DEBUG=1', '-g', '--asmlist',
        `--warn=${info.warningValue || '-9'}`,
        '--runtime=default,',
        `--opt=${info.optValue || '-local,-asmfile,+asm,-speed,+space,-debug'}`,
        '--stack=compiled:auto:auto:auto',
        '--addrqual=request', '--mode=pro',
        `--errformat=${errFmt}`, `--warnformat=${warnFmt}`, `--msgformat=${msgFmt}`,
        ...incDirs.map(d => `-I${d}`),
        `-O${hexPath}`,
        ...srcs,
    ];

    channel.appendLine('================ SCMCU 构建 ================');
    channel.appendLine(`[SCMCU] 工程: ${path.basename(scw)}`);
    channel.appendLine(`[SCMCU] 芯片: ${info.device}  ROM: ${params.romWords} word`);
    channel.appendLine(`[SCMCU] 编译器: ${path.join(comp.binDir, 'picc.exe')}`);
    channel.appendLine(`[SCMCU] 源文件(${srcs.length}): ${srcs.map(s => path.basename(s)).join(' ')}`);
    channel.appendLine(`[SCMCU] include: ${incDirs.map(d => path.basename(d) || d).join(' | ')}`);
    channel.appendLine('');

    const ok = await runPicc(path.join(comp.binDir, 'picc.exe'), args, workspaceRoot, channel, (lines) => {
        applyDiagnostics(lines, workspaceRoot);
    });
    if (!ok) { err(channel, '编译失败（见上方 picc 输出，错误已显示在"问题"面板可点击跳转）'); return false; }

    // ---- 生成 .scx 烧录文件 ----
    try {
        const hexText = fs.readFileSync(hexPath, 'utf-8');
        let words = info.configWords.slice(0, 4);
        while (words.length < 4) words.push(0xFFFF);
        const scx = hexToScx(hexText, info.device, words, params.romWords, params.hexmcu);
        fs.writeFileSync(scxPath, scx);
        channel.appendLine('');
        channel.appendLine(`[SCMCU] 配置字: ${words.map(w => w.toString(16).toUpperCase().padStart(4, '0')).join(',')}`);
        channel.appendLine(`[SCMCU] 烧录文件: ${scxPath} (${scx.length} 字节)`);
        const { sum, crc } = calcCfgChecks(scx, params.romWords);
        channel.appendLine(`[SCMCU] CfgCRC(Hex) -- 0x${crc.toString(16).toUpperCase().padStart(4, '0')}  CfgSum(Hex) -- 0x${sum.toString(16).toUpperCase().padStart(4, '0')}`);
        channel.appendLine('[SCMCU] ✅ 构建成功');
        vscode.window.showInformationMessage(`SCMCU 构建成功: ${path.basename(scxPath)}`);
    } catch (e: any) {
        err(channel, '生成 .scx 失败: ' + e.message);
        return false;
    }
    return true;
}

// 解析 SourceFile：带路径按字面拼；不带则按 sourceDirs → 根目录 → 常见目录兜底
function resolveSource(f: string, workspaceRoot: string, sourceDirs: string[]): string | null {
    if (f.includes('\\') || f.includes('/')) {
        const p = path.join(workspaceRoot, f);
        return fs.existsSync(p) ? p : null;
    }
    const candidates: string[] = [];
    for (const d of sourceDirs) {
        if (d !== '') candidates.push(path.join(workspaceRoot, d));
    }
    candidates.push(workspaceRoot); // 根目录兜底
    for (const sub of ['src', 'source', 'Src', 'sources', 'Source']) {
        candidates.push(path.join(workspaceRoot, sub));
    }
    for (const p of candidates) {
        const fq = path.join(p, f);
        if (fs.existsSync(fq)) return fq;
    }
    return null;
}

// 解析 picc 格式化的错误/警告 → VS Code 诊断（Problem 面板，可点击跳转）
function applyDiagnostics(lines: string[], workspaceRoot: string): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    // 新格式: 路径:行:列: Error[编号] 消息 (路径打头, VS Code 输出面板自动出 Ctrl+点击链接)
    // Windows 盘符含冒号(C:\)，文件名段必须用非贪婪 .+? 匹配到 ":数字:数字:" 为止
    const DIAG_RE = /^(.+?):(\d+):(\d+):\s*(Error|Warning|Info)\[(\d+)\]\s*(.*)$/;
    for (const raw of lines) {
        const m = raw.trim().match(DIAG_RE);
        if (!m) continue;
        const sev = m[4];
        const ln = Math.max(0, parseInt(m[2], 10) - 1);
        const col = Math.max(0, parseInt(m[3], 10) - 1);
        const msg = `${m[5]} - ${m[6]}`;
        const severity = sev === 'Error'
            ? vscode.DiagnosticSeverity.Error
            : sev === 'Warning'
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information;
        const diag = new vscode.Diagnostic(
            new vscode.Range(ln, col, ln, Math.max(col + 1, ln + 1)),
            msg,
            severity,
        );
        diag.source = 'SCMCU';
        let file = m[1].trim();
        if (!path.isAbsolute(file)) file = path.join(workspaceRoot, file);
        const key = file.toLowerCase();
        if (!byFile.has(key)) byFile.set(key, []);
        byFile.get(key)!.push(diag);
    }
    for (const [key, diags] of byFile) {
        diagCollection.set(vscode.Uri.file(key), diags);
    }
}

function runPicc(
    exe: string,
    args: string[],
    cwd: string,
    channel: vscode.OutputChannel,
    onLines?: (lines: string[]) => void,
): Promise<boolean> {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(exe, args, { cwd });
        } catch (e: any) {
            channel.appendLine('[SCMCU] 启动失败: ' + e.message);
            resolve(false);
            return;
        }
        let buf = '';
        const collected: string[] = [];
        const onData = (d: Buffer) => {
            buf += d.toString();
            const lines = buf.split(/\r?\n/);
            buf = lines.pop() || '';
            for (const l of lines) {
                if (l.trim()) {
                    channel.appendLine(l);
                    collected.push(l);
                }
            }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (e) => { channel.appendLine('[SCMCU] 启动失败: ' + e.message); });
        child.on('close', (code) => {
            if (buf.trim()) {
                channel.appendLine(buf.trim());
                collected.push(buf.trim());
            }
            channel.appendLine('');
            channel.appendLine(`[SCMCU] picc 退出码: ${code}`);
            if (onLines) onLines(collected);
            resolve(code === 0);
        });
    });
}

function err(channel: vscode.OutputChannel, msg: string): void {
    channel.appendLine('[SCMCU] ❌ ' + msg);
    vscode.window.showErrorMessage('SCMCU: ' + msg);
}
