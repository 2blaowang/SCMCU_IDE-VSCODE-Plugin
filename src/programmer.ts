// programmer.ts — SCMCU 编程器（烧录器）识别
//
// 识别机制参考对官方 SCMCU_Writer（Writer.Core.dll + scmcu writer.exe）的反编译结论：
//   - 官方软件按机型从加密配置 system.info 取 VID/PID，再用 Windows HID API 轮询比对；
//   - 真实设备表：所有编程器 USB VID = 0x1209，正常模式 / 升级(bootloader)模式各一个 PID：
//        WRITER8 LITE  -> 0x0201 / 0x0101
//        WRITER V8     -> 0x0032 / 0x0011
//        WRITER V8 PRO -> 0x0023 / 0x0021
//        ICE8 PRO      -> 0x1502 / 0x1102
//   本模块不依赖 vscode，纯 Node，便于回归测试。枚举优先 pnputil（原生可执行文件），
//   失败时回退 PowerShell Get-PnpDevice。仅 Windows 有意义，非 Windows 恒返回空。
import * as cp from 'child_process';

export interface ProgrammerDevice {
    pidHex: string;                 // 4 位大写十六进制 PID，如 '0201'
    name: string;                   // 型号名，如 'WRITER8 LITE'
    mode: 'normal' | 'bootloader' | 'unknown';
}

interface ModelInfo { name: string; mode: 'normal' | 'bootloader'; }

// 正常 / 升级模式 PID 表（来自官方 Writer 反编译的设备库）
const PID_TABLE: Record<string, ModelInfo> = {
    '0201': { name: 'WRITER8 LITE', mode: 'normal' },
    '0101': { name: 'WRITER8 LITE', mode: 'bootloader' },
    '0032': { name: 'WRITER V8', mode: 'normal' },
    '0011': { name: 'WRITER V8', mode: 'bootloader' },
    '0023': { name: 'WRITER V8 PRO', mode: 'normal' },
    '0021': { name: 'WRITER V8 PRO', mode: 'bootloader' },
    '1502': { name: 'ICE8 PRO', mode: 'normal' },
    '1102': { name: 'ICE8 PRO', mode: 'bootloader' },
};

// 纯函数：按 PID 归类（未知 PID 也返回，避免将来新硬件被静默忽略）
export function classifyPid(pidHex: string): ProgrammerDevice {
    const p = (pidHex || '').trim().replace(/^0[xX]/, '').toUpperCase();
    const hit = PID_TABLE[p];
    return hit
        ? { pidHex: p, name: hit.name, mode: hit.mode }
        : { pidHex: p, name: '未知编程器', mode: 'unknown' };
}

// 纯函数：从枚举输出文本提取去重 PID（pnputil / PowerShell 输出都适用，pnputil 常同时
// 出现 USB 父设备与 HID 子接口两条同 PID 记录，故按出现顺序去重）
export function parseDeviceIds(text: string): string[] {
    const out: string[] = [];
    const push = (pid: string): void => {
        const up = pid.toUpperCase();
        if (out.indexOf(up) < 0) out.push(up);
    };
    // 带前缀的枚举输出（pnputil：USB/HID\\VID_1209&PID_xxxx\\...）
    const re = /VID_1209&PID_([0-9A-Fa-f]{4})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) push(m[1]);
    // 整行只有裸 PID 的输出（回退枚举器格式：每行一个 4 位十六进制）
    const re2 = /(?:^|[\r\n])\s*([0-9A-Fa-f]{4})\s*(?:[\r\n]|$)/g;
    while ((m = re2.exec(text)) !== null) push(m[1]);
    return out;
}

// 检测当前连接的 SCMCU 编程器（仅 Windows；非 Windows 恒返回空数组）
export async function detectProgrammers(timeoutMs = 4000): Promise<ProgrammerDevice[]> {
    if (process.platform !== 'win32') return [];
    let raw = '';
    try {
        raw = await execText('pnputil', ['/enum-devices', '/connected', '/deviceids'], timeoutMs);
    } catch (e) {
        // 老系统无 pnputil 或被执行策略禁用 → 回退 PowerShell
        const ps = "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | ForEach-Object { $m=[regex]::Match($_.InstanceId,'VID_1209&PID_([0-9A-Fa-f]{4})'); if($m.Success){ $m.Groups[1].Value.ToUpper() } } | Sort-Object -Unique";
        raw = await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], timeoutMs);
    }
    return parseDeviceIds(raw).map(classifyPid);
}

function execText(cmd: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        cp.execFile(cmd, args, {
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 4 * 1024 * 1024,
            encoding: 'utf8',
        }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout || '');
        });
    });
}
