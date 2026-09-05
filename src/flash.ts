// flash.ts — 一键下载：编译后调用 SCMCU Writer 烧录助手（ScmcuFlashHelper.exe）烧录 .scx
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { detectProgrammers } from './programmer';

export interface FlashResult { ok: boolean; message: string; }

// 判定目录是否为 SCMCU Writer 安装目录（library/Writer.Core.dll + data/system.info + data/database.db）
export function isWriterDir(dir: string): boolean {
    try {
        return fs.existsSync(path.join(dir, 'library', 'Writer.Core.dll'))
            && fs.existsSync(path.join(dir, 'data', 'system.info'))
            && fs.existsSync(path.join(dir, 'data', 'database.db'));
    } catch { return false; }
}

// 查找 Writer 安装目录：优先 scmcu.writerPath 设置，其次扫描盘符根目录 SCMCU_Writer* 命名的目录
export function findWriterDir(): string | null {
    const cfg = vscode.workspace.getConfiguration('scmcu');
    const custom = (cfg.get<string>('writerPath', '') || '').trim();
    if (custom) {
        if (isWriterDir(custom)) return custom;
        // 用户配置了但不可用，继续自动探测并给出提示由调用方处理
    }
    const drives = ['C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'I:', 'J:'];
    // 候选父目录：盘符根 + 常见软件目录（Work / Program Files / Program Files (x86)）
    const parents = ['', 'Work', 'Program Files', 'Program Files (x86)', 'gat', 'gat\\sheet\\中微'];
    const seen = new Set<string>();
    for (const drv of drives) {
        for (const sub of parents) {
            const dir = drv + '\\' + (sub ? sub + '\\' : '');
            if (!fs.existsSync(dir)) continue;
            let entries: string[] = [];
            try { entries = fs.readdirSync(dir); } catch { continue; }
            for (const e of entries) {
                if (!/^SCMCU_Writer/i.test(e)) continue;
                const full = path.join(dir, e);
                if (seen.has(full)) continue;
                seen.add(full);
                if (isWriterDir(full)) return full;
            }
        }
    }
    return null;
}

// 执行烧录。scxPath: 固件文件; helperExe: ScmcuFlashHelper.exe 绝对路径; probe: true=只做链路探测不烧录
export async function flashScx(
    scxPath: string,
    helperExe: string,
    channel: vscode.OutputChannel,
    count: number,
    probe: boolean
): Promise<FlashResult> {
    if (!fs.existsSync(scxPath)) {
        return { ok: false, message: '固件文件不存在: ' + scxPath };
    }
    const writer = findWriterDir();
    if (!writer) {
        return { ok: false, message: '未找到 SCMCU Writer 安装目录。请安装 SCMCU Writer，或在设置 scmcu.writerPath 中指定（需含 library/Writer.Core.dll 与 data/database.db）' };
    }
    if (!fs.existsSync(helperExe)) {
        return { ok: false, message: '缺少烧录助手程序: ' + helperExe + '（插件安装不完整）' };
    }
    const devs = await detectProgrammers();
    const normal = devs.find((d) => d.mode !== 'bootloader');
    if (!normal) {
        return {
            ok: false,
            message: devs.length > 0
                ? '检测到的编程器处于升级(bootloader)模式，请先用 SCMCU Writer 的升级功能恢复到正常模式'
                : '未检测到 SCMCU 编程器（USB VID 0x1209）。请连接编程器并确认处于正常模式后重试',
        };
    }

    const args = ['--writer', writer, '--scx', scxPath, '--pid', normal.pidHex];
    // count=0 表示无限(不传 --count，助手默认无限)；>0 才作为烧写次数上限传入
    if (count > 0) args.push('--count', String(count));
    if (probe) args.push('--probe');

    channel.appendLine(`[SCMCU] 烧录助手: ${path.basename(helperExe)}  编程器: ${normal.name} (PID 0x${normal.pidHex})`);
    channel.appendLine(`[SCMCU] 固件: ${scxPath}   Writer: ${writer}`);
    channel.appendLine(`[SCMCU] ${probe ? '—— 探测模式（不烧录）——' : '—— 开始下载 ——'}`);

    return new Promise<FlashResult>((resolve) => {
        let errText = '';
        const child = spawn(helperExe, args, { cwd: path.dirname(helperExe) });
        child.stdout.on('data', (c: Buffer) => { channel.append(c.toString('utf8')); });
        child.stderr.on('data', (c: Buffer) => {
            const s = c.toString('utf8');
            errText += s;
            channel.append(s);
        });
        child.on('error', (e) => resolve({ ok: false, message: '无法启动烧录助手: ' + e.message }));
        child.on('close', (code) => {
            channel.appendLine('');
            if (code === 0) {
                resolve({ ok: true, message: probe ? '链路探测通过（未烧录）' : '下载完成' });
            } else {
                const msg = errText.trim().replace(/^\[ERROR\]\s*/m, '');
                resolve({ ok: false, message: msg || `烧录助手异常退出（代码 ${code}）` });
            }
        });
    });
}
