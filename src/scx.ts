// scx.ts — .scx 烧录文件生成（移植自 make_scx.py，已验证与 IDE 产物字节级一致）
import * as fs from 'fs';
import * as path from 'path';

export function parseIntelHex(text: string): Map<number, number> {
    const data = new Map<number, number>();
    let base = 0;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line.startsWith(':')) continue;
        let b: Buffer;
        try { b = Buffer.from(line.slice(1), 'hex'); } catch { continue; }
        if (b.length < 5) continue;
        const count = b[0];
        const addr = (b[1] << 8) | b[2];
        const typ = b[3];
        if (typ === 0x00) {
            for (let i = 0; i < count; i++) data.set(base + addr + i, b[4 + i]);
        } else if (typ === 0x04) {
            base = ((b[4] << 8) | b[5]) << 16;
        } else if (typ === 0x01) {
            break;
        }
    }
    return data;
}

export function hexToProgram(data: Map<number, number>, romWords: number): Buffer {
    const size = romWords * 2;
    const prog = Buffer.alloc(size, 0xFF);
    for (let i = 0; i < size; i++) {
        if (data.has(i)) prog[i] = data.get(i)!;
    }
    return prog;
}

// bin 程序区 -> scx 程序区：未编程 word (0xFFFF) 替换为 HEXMCU
export function toScxProgram(prog: Buffer, hexmcu: number): Buffer {
    const out = Buffer.from(prog);
    for (let i = 0; i + 1 < out.length; i += 2) {
        const w = out[i] | (out[i + 1] << 8);
        if (w === 0xFFFF) {
            out[i] = hexmcu & 0xFF;
            out[i + 1] = (hexmcu >> 8) & 0xFF;
        }
    }
    return out;
}

// 组装 .scx：256B 头（芯片名 + '!' + 4 配置字槽）+ 程序区
// 注意: 芯片名 + '!' 不能截断! 如 SC8P052B 是 8 字符+! = 9 字节,
//       烧录器靠 '!' (0x21) 识别固件, 截断会导致识别失败
export function buildScx(chip: string, words: number[], scxProg: Buffer): Buffer {
    const scx = Buffer.alloc(0x100 + scxProg.length);
    const name = Buffer.from(chip + '!', 'ascii');
    if (name.length <= 0x9F) {
        name.copy(scx, 0);
    } else {
        name.subarray(0, 0x9F).copy(scx, 0);
    }
    for (let i = 0; i < 4; i++) {
        const w = i < words.length ? words[i] : 0xFFFF;
        scx[0xA0 + i * 2] = w & 0xFF;
        scx[0xA0 + i * 2 + 1] = (w >> 8) & 0xFF;
    }
    for (let i = 0xA8; i < 0xC0; i++) scx[i] = 0xFF;
    scxProg.copy(scx, 0x100);
    return scx;
}

// 便捷入口：hex 文本 -> scx Buffer
export function hexToScx(hexText: string, chip: string, words: number[], romWords: number, hexmcu: number): Buffer {
    const data = parseIntelHex(hexText);
    const prog = hexToProgram(data, romWords);
    const scxProg = toScxProgram(prog, hexmcu);
    return buildScx(chip, words, scxProg);
}

// 查找工程内已有的 .scx 烧录文件（工程根目录 + 输出目录）
export function findScxFiles(workspaceRoot: string, buildDirName: string): string[] {
    const out: string[] = [];
    const dirs = [workspaceRoot, path.join(workspaceRoot, buildDirName)];
    for (const d of dirs) {
        if (!fs.existsSync(d)) continue;
        let entries: string[] = [];
        try { entries = fs.readdirSync(d); } catch { continue; }
        for (const e of entries) {
            if (e.toLowerCase().endsWith('.scx')) out.push(path.join(d, e));
        }
    }
    return out;
}

// 直接改写 .scx 的 4 个配置字槽位（0xA0-0xA7），程序区不动。
// 校验芯片名一致，避免误改其它芯片的文件。返回是否成功。
export function patchScxConfigWords(scxPath: string, chip: string, words: number[]): boolean {
    if (!fs.existsSync(scxPath)) return false;
    const buf = fs.readFileSync(scxPath);
    if (buf.length < 0xA8) return false;
    const name = Buffer.from((chip + '!').slice(0, 8), 'ascii');
    for (let i = 0; i < 8; i++) {
        if (buf[i] !== name[i]) return false; // 芯片名不匹配
    }
    for (let i = 0; i < 4; i++) {
        const w = i < words.length ? words[i] : 0xFFFF;
        buf[0xA0 + i * 2] = w & 0xFF;
        buf[0xA0 + i * 2 + 1] = (w >> 8) & 0xFF;
    }
    fs.writeFileSync(scxPath, buf);
    return true;
}

// 各芯片的配置字数量（烧录器按芯片数据库决定参与校验和的配置槽数；.scx 定长 4 槽，但只算前 N 槽）
// 以实测/烧录器核对为准，不能看 .scw 列了几个（.scw 会用 FFFF 补齐到 4 个，如 SC8F052 的 config=3FFB,3FEF,FFFF,FFFF 实际只有 2 个字）：
//   SC8F052 实测 2 槽（3FFB,3FEF → SUM A5AE / CRC 20CD）
//   SC8F072 实测 4 槽（FFFF,FAEF,FFFF,FFFF → SUM 4619 / CRC EC0D；其 .cfg 模板虽只到 word1，但烧录器按 4 槽）
// 未收录芯片：build.ts 会传芯片模板推导的配置字数；再兜底默认 4。
const CFG_WORD_COUNT: Record<string, number> = {
    SC8F052: 2,
    SC8F072: 4,
};

// 非 CMS 内核芯片列表（Writer.Core 的 GetCheckSum 里：SUM 只加配置字低字节，高字节仅 CMSCore 芯片加）。
// SC8F052 / SC8F072 实测均为 CMS 内核（低+高都加）。遇到非 CMS 内核芯片时在此登记芯片名。
const NON_CMS_CORE: string[] = [];

function readScxChipName(scx: Buffer): string {
    let end = scx.indexOf(0x21); // '!'
    if (end < 0) end = Math.min(scx.length, 0x9f);
    return scx.toString('ascii', 0, end < 0 ? 0 : end);
}

// 计算 .scx 的 CfgSum 和 CfgCRC（算法与 Writer.Core.dll 反编译的 GetCheckSum / GetDataCRC16 一致）
//   .scx 配置字区固定为 [0xA0,0xA8) 共 4 个槽（8 字节），但参与校验和的槽数 = 该芯片的配置字数量 N：
//     SC8F052 = 2 槽（[0xA0,0xA4)）；SC8F072 = 4 槽（[0xA0,0xA8)）
//   CfgCRC = 对 [程序区字节 + 前 N 个配置字槽字节（低+高）] 做 CRC-16/CCITT-FALSE (poly=0x1021, init=0xFFFF, xorout=0)
//            （对应 GetDataCRC16: GetCRC16L_1021_FFFF_0000(0xFFFF, romDatas+bootRom+GetConfigByteDatas)）
//   CfgSum = (Σ程序区字节 + Σ前 N 个配置字 [低字节 + (CMSCore ? 高字节 : 0)]) & 0xFFFF
//            （对应 GetCheckSum: num2 += ConfigDatas[i] & 0xFF; if CMSCore num2 += ConfigDatas[i] >> 8）
//   —— 实测样本（烧录器显示）：SC8F052: CfgSum=0xA5AE CfgCRC=0x20CD（2 槽）
//      SC8F072: CfgSum=0x4619 CfgCRC=0xEC0D（4 槽）
export function calcCfgChecks(scx: Buffer, romWords?: number, cfgWordCount?: number): { sum: number; crc: number } {
    const progEnd = romWords !== undefined && romWords > 0 ? 0x100 + romWords * 2 : scx.length;
    const prog = scx.subarray(0x100, progEnd);
    const chip = readScxChipName(scx);

    // 槽数优先级：实测芯片表 → build.ts 传入的推导值 → 默认 4
    let n = CFG_WORD_COUNT[chip] !== undefined ? CFG_WORD_COUNT[chip] : (cfgWordCount !== undefined && cfgWordCount > 0 ? cfgWordCount : 4);
    if (n < 0) n = 0;
    if (n > 4) n = 4;
    const cfg = scx.subarray(0xa0, 0xa0 + n * 2); // 前 n 个槽

    // CfgCRC：程序区 → 配置字区（低+高字节，原值）
    let crc = 0xffff;
    const step = (b: number) => {
        crc ^= b << 8;
        for (let k = 0; k < 8; k++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
        }
    };
    for (let i = 0; i < prog.length; i++) step(prog[i]);
    for (let i = 0; i < cfg.length; i++) step(cfg[i]);

    // CfgSum：程序区字节 + 配置字 [低字节 + (CMSCore ? 高字节 : 0)]
    const isCmsCore = !NON_CMS_CORE.includes(chip);
    let sum = 0;
    for (let i = 0; i < prog.length; i++) sum = (sum + prog[i]) & 0xffff;
    for (let i = 0; i < n; i++) {
        const w = scx[0xa0 + i * 2] | (scx[0xa0 + i * 2 + 1] << 8);
        sum = (sum + (w & 0xff)) & 0xffff;
        if (isCmsCore) sum = (sum + ((w >> 8) & 0xff)) & 0xffff;
    }

    return { sum, crc };
}

// 校验 .scx 是否与参考文件一致（调试用）
export function scxDiff(a: Buffer, b: Buffer): string[] {
    const diffs: string[] = [];
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) diffs.push(`byte ${i} (0x${i.toString(16)}): ${a[i].toString(16)} vs ${b[i].toString(16)}`);
    }
    if (a.length !== b.length) diffs.push(`长度不同: ${a.length} vs ${b.length}`);
    return diffs.slice(0, 10);
}
