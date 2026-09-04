#!/usr/bin/env node
/**
 * 配置字修复回归测试（可复跑）
 *
 * 覆盖 2026-09-04 配置字计算修复（SC8F052 工程出现 FFFB,FAEF,FFFF,FFFF 异常）：
 *   Fix #1   每芯片未编程值解析 —— loadChipParams 优先 .ini HEXMCU；
 *            缺失 .ini 时按型号兜底 resolveHexmcu（14-bit=0x3FFF / 16-bit=0xFFFF）
 *   Fix #2   computeConfigWordsFromBase 位宽 mask（清掉 14-bit 芯片 0xF 高位）
 *   Fix #1+#2 normalizeConfigWordsCore 规范化命令核心算法
 *            （保留模板定义位、复位未定义固定位、纯 16 位芯片仅 mask 不误改 FAEF、幂等）
 *
 * 数据源：test/fixtures/ide（从真实 SCMCU_IDE 的 mcu/config、mcu/ini 拷入，见
 *         test/fixtures/README.md）。不依赖本机安装的 IDE，clone 后即可运行。
 * 被测对象：out/chip.js 中的真实实现（先 npm run compile），而非本文件的复刻。
 *
 * 运行：npm run compile && npm test
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT_CHIP = path.join(ROOT, 'out', 'chip.js');
if (!fs.existsSync(OUT_CHIP)) {
    console.error('[configWords] 缺少 out/chip.js —— 请先运行: npm run compile');
    process.exit(2);
}
// 模拟 SCMCU_IDE 安装目录：<idePath>/mcu/config/<chip>.cfg、<idePath>/mcu/ini/<chip>.ini
const IDE = path.join(__dirname, 'fixtures', 'ide');

const chip = require(OUT_CHIP);

// ---------- 断言工具 ----------
let pass = 0;
let fail = 0;
function check(name, got, expected) {
    const ok = got === expected;
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? '  PASS' : '!!FAIL'}  ${name}`);
    if (!ok) {
        console.log(`         got   : ${got}`);
        console.log(`         expect: ${expected}`);
    }
}
function h4(x) { return '0x' + x.toString(16).toUpperCase().padStart(4, '0'); }
function hxArr(a) { return a.map(h4).join(','); }

// ---------- 夹具自检 ----------
console.log('== 夹具自检 ==');
check('listChips 识别 SC8F052/SC8F072',
    chip.listChips(IDE).join(','),
    'SC8F052,SC8F072');

// ---------- Fix #1: HEXMCU 解析与型号兜底 ----------
console.log('\n== Fix #1: 每芯片未编程值 HEXMCU（.ini 优先 / 缺失兜底）==');
check('SC8F052   .ini HEXMCU=3FFF', h4(chip.loadChipParams(IDE, 'SC8F052').hexmcu), '0x3FFF');
check('SC8F072   .ini HEXMCU=FFFF', h4(chip.loadChipParams(IDE, 'SC8F072').hexmcu), '0xFFFF');
// 带后缀型号无独立 .ini（fixtures 中未放置）→ 走 resolveHexmcu 兜底
check('SC8F052A04 无.ini → 兜底 0x3FFF', h4(chip.loadChipParams(IDE, 'SC8F052A04').hexmcu), '0x3FFF');
check('SC8F072A04 无.ini → 兜底 0xFFFF', h4(chip.loadChipParams(IDE, 'SC8F072A04').hexmcu), '0xFFFF');
check('SC8F054   无.ini → 兜底 0x3FFF', h4(chip.loadChipParams(IDE, 'SC8F054').hexmcu), '0x3FFF');
check('SC8P061   无.ini → 兜底 0xFFFF', h4(chip.loadChipParams(IDE, 'SC8P061').hexmcu), '0xFFFF');

// ---------- Fix #2: computeConfigWordsFromBase 位宽 mask ----------
console.log('\n== Fix #2: computeConfigWordsFromBase 位宽 mask（空选项隔离出 mask 行为）==');
{
    const tpl = chip.parseCfgTemplate(path.join(IDE, 'mcu', 'config', 'SC8F052.cfg'));
    const hex = chip.loadChipParams(IDE, 'SC8F052').hexmcu;
    const got = chip.computeConfigWordsFromBase(tpl, {}, [0xFFFB, 0xFAEF, 0xFFFF, 0xFFFF], hex);
    check('SC8F052 mask(FFFB,FAEF,FFFF,FFFF) 清高位', hxArr(got), '0x3FFB,0x3AEF,0x3FFF,0x3FFF');
}

// ---------- Fix #1+#2: normalizeConfigWordsCore 规范化 ----------
console.log('\n== Fix #1+#2: normalizeConfigWordsCore 规范化（与 SCMCU_IDE 期望一致）==');
{
    // 用户上报的串芯片场景：SC8F052 基底来自 SC8F072（16-bit 全宽）→ 应为 IDE 的 3FFB,3FEF,3FFF,3FFF
    let got = chip.normalizeConfigWordsCore([0xFFFB, 0xFAEF, 0xFFFF, 0xFFFF], 'SC8F052', IDE);
    check('SC8F052 串芯片(FFFB,FAEF,FFFF,FFFF) → IDE 期望', hxArr(got), '0x3FFB,0x3FEF,0x3FFF,0x3FFF');

    // 纯 16 位芯片：FAEF 的隐藏位（bit4/8/10=0）不能被误改成全 1
    got = chip.normalizeConfigWordsCore([0xFFFF, 0xFAEF, 0xFFFF, 0xFFFF], 'SC8F072', IDE);
    check('SC8F072 保持(FFFF,FAEF,FFFF,FFFF) 不误改', hxArr(got), '0xFFFF,0xFAEF,0xFFFF,0xFFFF');

    // 幂等：已规范工程 / 未编程工程重复执行结果不变
    got = chip.normalizeConfigWordsCore([0x3FFB, 0x3FEF, 0x3FFF, 0x3FFF], 'SC8F052', IDE);
    check('SC8F052 已规范 → 幂等', hxArr(got), '0x3FFB,0x3FEF,0x3FFF,0x3FFF');
    got = chip.normalizeConfigWordsCore([0x3FFF, 0x3FEF, 0x3FFF, 0x3FFF], 'SC8F052', IDE);
    check('SC8F052 未编程(3FFF,3FEF,...) → 幂等', hxArr(got), '0x3FFF,0x3FEF,0x3FFF,0x3FFF');

    // 基底不足 4 字 / 空基底（scw-less 首次）也不越界
    got = chip.normalizeConfigWordsCore([0xFFFB, 0xFAEF], 'SC8F052', IDE);
    check('SC8F052 仅 2 字基底 → 保持长度', hxArr(got), '0x3FFB,0x3FEF');
    got = chip.normalizeConfigWordsCore([0x3FFF], 'SC8F052', IDE);
    check('SC8F052 仅 1 字基底 → 保持长度', hxArr(got), '0x3FFF');

    // 模板缺失时不做改动（调用方已先报错），防止空指针
    got = chip.normalizeConfigWordsCore([0x3FFB, 0x3FEF, 0x3FFF, 0x3FFF], 'NO_SUCH_CHIP', IDE);
    check('模板缺失 → 原样返回', hxArr(got), '0x3FFB,0x3FEF,0x3FFF,0x3FFF');
}

console.log(`\n==== 结果: ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
