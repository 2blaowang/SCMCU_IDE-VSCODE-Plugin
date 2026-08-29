// chip.ts — .scw 工程文件解析、芯片列表、cfg 选项模板、配置字计算
import * as fs from 'fs';
import * as path from 'path';

export interface ScwInfo {
    device: string;
    sourceFiles: string[];
    headFiles: string[];
    configWords: number[];
    optValue: string;
    warningValue: string;
}

export function findScwFile(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    for (const e of fs.readdirSync(dir)) {
        if (e.toLowerCase().endsWith('.scw')) return path.join(dir, e);
    }
    return null;
}

export function parseScw(scwPath: string): ScwInfo {
    const info: ScwInfo = { device: '', sourceFiles: [], headFiles: [], configWords: [], optValue: '', warningValue: '' };
    const text = fs.readFileSync(scwPath, 'utf-8');
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (/^Device=/i.test(line)) info.device = line.split('=')[1].trim();
        else if (/^SourceFile=/i.test(line)) info.sourceFiles.push(line.split('=')[1].trim());
        else if (/^HeadFile=/i.test(line)) info.headFiles.push(line.split('=')[1].trim());
        else if (/^config=/i.test(line)) {
            const vals = line.split('=')[1].trim().split(',');
            info.configWords = vals.filter(v => v.trim() !== '').map(v => parseInt(v, 16) & 0xFFFF);
        } else if (/^OptValue=/i.test(line)) info.optValue = line.split('=')[1].trim();
        else if (/^WarningValue=/i.test(line)) info.warningValue = line.split('=')[1].trim();
    }
    return info;
}

export function writeScwDevice(scwPath: string, device: string): void {
    const text = fs.readFileSync(scwPath, 'utf-8');
    const updated = text.includes('Device=')
        ? text.replace(/^Device=.*$/m, `Device=${device}`)
        : text + `\nDevice=${device}\n`;
    fs.writeFileSync(scwPath, updated, 'utf-8');
}

export function writeScwConfig(scwPath: string, words: number[]): void {
    const text = fs.readFileSync(scwPath, 'utf-8');
    const line = 'config=' + words.map(w => w.toString(16).toUpperCase().padStart(4, '0')).join(',') + ',';
    const updated = text.includes('config=')
        ? text.replace(/^config=.*$/m, line)
        : text.replace(/^(\[FILE\])/m, `${line}\n$1`);
    fs.writeFileSync(scwPath, updated, 'utf-8');
}

// ---- 芯片列表：扫描 IDE 的 mcu/config/*.cfg ----
export function listChips(idePath: string): string[] {
    const cfgDir = path.join(idePath, 'mcu', 'config');
    if (!fs.existsSync(cfgDir)) return [];
    return fs.readdirSync(cfgDir)
        .filter(f => f.toLowerCase().endsWith('.cfg'))
        .map(f => path.basename(f, '.cfg'))
        .sort();
}

// ---- 芯片参数：从 mcu/ini/<chip>.ini 读 ROMSIZE / HEXMCU ----
export interface ChipParams { romWords: number; hexmcu: number; }

export function loadChipParams(idePath: string, device: string): ChipParams {
    const iniPath = path.join(idePath, 'mcu', 'ini', device + '.ini');
    if (fs.existsSync(iniPath)) {
        const d: Record<string, string> = {};
        for (const raw of fs.readFileSync(iniPath, 'utf-8').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('[')) continue;
            const idx = line.indexOf('=');
            if (idx > 0) d[line.slice(0, idx).trim().toUpperCase()] = line.slice(idx + 1).trim();
        }
        const romsize = parseInt(d['ROMSIZE'] || '3FF', 16);
        const hexmcu = parseInt(d['HEXMCU'] || 'FFFF', 16);
        return { romWords: romsize + 1, hexmcu };
    }
    return { romWords: 1024, hexmcu: 0x3FFF }; // 默认 SC8F052
}

// ---- cfg 选项模板：mcu/config/<chip>.cfg ----
export interface CfgBit { word: number; bit: number; val: number; }
export type CfgSection = Record<string, CfgBit[]>;
export type CfgTemplate = Record<string, CfgSection>;

export function parseCfgTemplate(cfgPath: string): CfgTemplate {
    const tpl: CfgTemplate = {};
    let cur: string | null = null;
    for (const raw of fs.readFileSync(cfgPath, 'utf-8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const m = line.match(/^\[(.+)\]$/);
        if (m) { cur = m[1]; tpl[cur] = tpl[cur] || {}; continue; }
        if (!cur) continue;
        const idx = line.indexOf('=');
        if (idx <= 0) continue;
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k === 'DISPMODE') continue;
        const items: CfgBit[] = [];
        for (const it of v.split(':')) {
            const p = it.split(',').map(s => parseInt(s, 10));
            if (p.length === 3) items.push({ word: p[0], bit: p[1], val: p[2] });
        }
        tpl[cur][k] = items;
    }
    return tpl;
}

// 按选项选择计算 4 个配置字（初始 = hexmcu 全填）
export function computeConfigWords(tpl: CfgTemplate, selections: Record<string, string>, hexmcu: number): number[] {
    const words = [hexmcu, hexmcu, hexmcu, hexmcu];
    for (const sec of Object.keys(selections)) {
        const bits = tpl[sec]?.[selections[sec]];
        if (!bits) continue;
        for (const { word, bit, val } of bits) {
            if (word < 0 || word > 3) continue;
            if (val) words[word] |= (1 << bit);
            else words[word] &= ~(1 << bit);
        }
    }
    return words;
}

// 从芯片配置模板推导该芯片的配置字数量（最大 word 索引 + 1）。
// 仅作未知芯片的兜底估算；已知芯片以 scx.ts 的 CFG_WORD_COUNT 实测表为准
// （SC8F072 模板只用到 word1，但烧录器实测按 4 槽，故该芯片以实测表 4 为准）。
export function getChipConfigWordCount(idePath: string, device: string): number {
    try {
        const cfgPath = path.join(idePath, 'mcu', 'config', device + '.cfg');
        if (!fs.existsSync(cfgPath)) return 0;
        const tpl = parseCfgTemplate(cfgPath);
        let maxWord = -1;
        for (const sec of Object.keys(tpl)) {
            for (const opt of Object.keys(tpl[sec])) {
                for (const b of tpl[sec][opt]) {
                    if (b.word > maxWord) maxWord = b.word;
                }
            }
        }
        return maxWord >= 0 ? maxWord + 1 : 0;
    } catch { return 0; }
}

// 以 .scw 当前配置字为基底，只重算"本节选项涉及到的位"，
// 保留模板未定义的隐藏位（如 SC8F072 word1 bit4）。保存硬件选项必须用这个。
export function computeConfigWordsFromBase(tpl: CfgTemplate, selections: Record<string, string>, baseWords: number[], hexmcu: number): number[] {
    const words = baseWords.slice(0, 4);
    while (words.length < 4) words.push(hexmcu);
    for (const sec of Object.keys(selections)) {
        const section = tpl[sec];
        if (!section || !section[selections[sec]]) continue;
        // 本节所有选项的位并集（先恢复为未编程位值，再应用选中选项）
        const touched = new Set<string>();
        for (const opt of Object.keys(section)) {
            for (const { word, bit } of section[opt]) touched.add(word + ':' + bit);
        }
        for (const k of touched) {
            const [w, b] = k.split(':').map(Number);
            if (w > 3) continue;
            if ((hexmcu >> b) & 1) words[w] |= (1 << b);
            else words[w] &= ~(1 << b);
        }
        for (const { word, bit, val } of section[selections[sec]]) {
            if (word > 3) continue;
            if (val) words[word] |= (1 << bit);
            else words[word] &= ~(1 << bit);
        }
    }
    return words;
}

// 反查：给定配置字，找出每个节当前匹配的选项名（用于回显）
export function detectCurrentSelections(tpl: CfgTemplate, words: number[]): Record<string, string> {
    const sel: Record<string, string> = {};
    for (const sec of Object.keys(tpl)) {
        for (const opt of Object.keys(tpl[sec])) {
            let match = true;
            for (const { word, bit, val } of tpl[sec][opt]) {
                if (word > 3) { match = false; break; }
                if (((words[word] >> bit) & 1) !== val) { match = false; break; }
            }
            if (match) { sel[sec] = opt; break; }
        }
    }
    return sel;
}

// ===== 源文件管理：按行就地改写 .scw 的 SourceFile= =====
// 顺序即编译顺序（XC8 psect 依赖），增删/重排都必须保持现有行的其它内容不动。

export function addScwSourceFile(scwPath: string, name: string): void {
    const text = fs.readFileSync(scwPath, 'utf-8');
    const lines = text.split(/\r?\n/);
    let lastIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^SourceFile=/i.test(lines[i].trim())) lastIdx = i;
    }
    const newLine = `SourceFile=${name}`;
    if (lastIdx >= 0) lines.splice(lastIdx + 1, 0, newLine);
    else lines.push(newLine);
    fs.writeFileSync(scwPath, lines.join('\n'), 'utf-8');
}

export function removeScwSourceFile(scwPath: string, name: string): boolean {
    const text = fs.readFileSync(scwPath, 'utf-8');
    const lines = text.split(/\r?\n/);
    let removed = false;
    for (let i = lines.length - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (/^SourceFile=/i.test(t) && t.split('=')[1].trim() === name) {
            lines.splice(i, 1);
            removed = true;
            break;
        }
    }
    if (removed) fs.writeFileSync(scwPath, lines.join('\n'), 'utf-8');
    return removed;
}

// dir = -1 上移（靠近队首），+1 下移。仅交换两个 SourceFile 行的位置，其余内容不动。
export function moveScwSourceFile(scwPath: string, name: string, dir: -1 | 1): boolean {
    const text = fs.readFileSync(scwPath, 'utf-8');
    const lines = text.split(/\r?\n/);
    const idxs: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (/^SourceFile=/i.test(lines[i].trim())) idxs.push(i);
    }
    const pos = idxs.findIndex(i => lines[i].trim().split('=')[1].trim() === name);
    if (pos < 0) return false;
    const target = pos + dir;
    if (target < 0 || target >= idxs.length) return false;
    const a = idxs[pos], b = idxs[target];
    const tmp = lines[a]; lines[a] = lines[b]; lines[b] = tmp;
    fs.writeFileSync(scwPath, lines.join('\n'), 'utf-8');
    return true;
}

// 扫描工程内可作为源文件的候选（排除已加入、build/node_modules/.git 等目录）
export function listCandidateSources(workspaceRoot: string, current: string[]): string[] {
    const out: string[] = [];
    const exts = ['.c', '.asm', '.s'];
    const skip = new Set(['build', 'node_modules', '.git', 'out', '.vscode', '.workbuddy']);
    const curLower = new Set(current.map(c => c.toLowerCase()));
    const walk = (dir: string): void => {
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { if (!skip.has(e.name)) walk(full); }
            else if (exts.includes(path.extname(e.name).toLowerCase())) {
                const rel = path.relative(workspaceRoot, full).split(path.sep).join('/');
                const base = path.basename(rel).toLowerCase();
                if (!curLower.has(rel.toLowerCase()) && !curLower.has(base)) out.push(rel);
            }
        }
    };
    walk(workspaceRoot);
    return out.sort();
}
