// compiler.ts — 编译器目录查找（配置 > 常见路径 > 盘符扫描 > 环境变量）
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface CompilerPaths { binDir: string; idePath: string; }

const PROGRAM_ROOTS = ['C:\\Program Files (x86)', 'C:\\Program Files'];
const DRIVES = ['C:', 'D:', 'E:', 'F:', 'G:', 'H:'];

export function findCompilerDir(): CompilerPaths | null {
    const cfg = vscode.workspace.getConfiguration('scmcu');
    const cfgBin = cfg.get<string>('compilerPath', '');
    const cfgIde = cfg.get<string>('idePath', '');

    // 1. 用户显式配置优先
    if (cfgBin && fs.existsSync(path.join(cfgBin, 'picc.exe'))) {
        const ide = cfgIde && fs.existsSync(path.join(cfgIde, 'mcu'))
            ? cfgIde
            : (cfgBin.toLowerCase().endsWith('bin') ? path.dirname(cfgBin) : cfgBin);
        return { binDir: cfgBin, idePath: ide };
    }

    // 2/3. 扫描常见安装位置 + 盘符根目录
    const found: string[] = [];
    const roots = PROGRAM_ROOTS.concat(DRIVES.map(d => d + '\\'));
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        let entries: string[] = [];
        try { entries = fs.readdirSync(root); } catch { continue; }
        for (const entry of entries) {
            if (!/^SCMCU_IDE/i.test(entry)) continue;
            const bin = path.join(root, entry, 'data', 'bin');
            if (fs.existsSync(path.join(bin, 'picc.exe'))) found.push(bin);
        }
    }

    // 4. 环境变量 SCMCU_IDE_HOME
    const envHome = process.env.SCMCU_IDE_HOME;
    if (envHome) {
        const bin = path.join(envHome, 'data', 'bin');
        if (fs.existsSync(path.join(bin, 'picc.exe'))) found.push(bin);
    }

    if (found.length === 0) return null;
    found.sort((a, b) => versionOf(b).localeCompare(versionOf(a), undefined, { numeric: true }));
    const bin = found[0];
    return { binDir: bin, idePath: path.dirname(path.dirname(bin)) };
}

function versionOf(binDir: string): string {
    const m = path.basename(path.dirname(binDir)).match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : '0';
}
