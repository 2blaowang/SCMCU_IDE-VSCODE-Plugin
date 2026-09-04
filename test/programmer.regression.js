'use strict';
// 回归测试：编程器识别（纯函数层：PID 归类 + 枚举输出解析）
// 运行：node test/programmer.regression.js   （npm test 会连带执行）
const pm = require('../out/programmer.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? '  got: ' + JSON.stringify(extra) : ''}`); }
}
function eq(actual, expected) { return JSON.stringify(actual) === JSON.stringify(expected); }

console.log('== classifyPid：已知型号 正常/升级模式 ==');
[
    ['0201', 'WRITER8 LITE', 'normal'],
    ['0101', 'WRITER8 LITE', 'bootloader'],
    ['0032', 'WRITER V8', 'normal'],
    ['0011', 'WRITER V8', 'bootloader'],
    ['0023', 'WRITER V8 PRO', 'normal'],
    ['0021', 'WRITER V8 PRO', 'bootloader'],
    ['1502', 'ICE8 PRO', 'normal'],
    ['1102', 'ICE8 PRO', 'bootloader'],
].forEach(([pid, name, mode]) => {
    const d = pm.classifyPid(pid);
    check(`PID ${pid} -> ${name} (${mode})`, d.name === name && d.mode === mode && d.pidHex === pid, d);
});

console.log('== classifyPid：边界 ==');
{
    const d = pm.classifyPid('ABCD');
    check('未知 PID ABCD -> 未知编程器/unknown', d.name === '未知编程器' && d.mode === 'unknown' && d.pidHex === 'ABCD', d);
    const d2 = pm.classifyPid('0x0201');
    check('带 0x 前缀 0x0201 归一到 0201', d2.pidHex === '0201' && d2.name === 'WRITER8 LITE', d2);
    const d3 = pm.classifyPid('abcd');
    check('小写 abcd -> 大写 ABCD 未知', d3.pidHex === 'ABCD' && d3.mode === 'unknown', d3);
    const d4 = pm.classifyPid('');
    check('空串 PID 安全返回 unknown', d4.mode === 'unknown', d4);
}

console.log('== parseDeviceIds：pnputil 混合输出 ==');
{
    // 模拟 pnputil /enum-devices /connected /deviceids 输出：USB 父设备 + HID 子接口重复出现同 PID
    const sample = [
        'Microsoft PnP 工具',
        '',
        '枚举设备节点：',
        '    设备实例 ID:            USB\\VID_1209&PID_0201\\6&1a2b3c&0&3',
        '    设备 ID:                USB\\VID_1209&PID_0201\\6&1a2b3c&0&3',
        '    硬件 ID:                HID\\VID_1209&PID_0201&MI_00',
        '    实例 ID:                HID\\VID_1209&PID_0201&MI_00\\7&1d2e3f&0&0000',
        '    设备 ID:                USB\\VID_046D&PID_C52B\\8&abc&0&1',
        '',
        '    设备实例 ID:            USB\\VID_1209&PID_0032\\1&0&0&0',
        '',
    ].join('\n');
    const pids = pm.parseDeviceIds(sample);
    check('解析去重 [0201, 0032]，忽略其它 VID', eq(pids, ['0201', '0032']), pids);
}
{
    const pids = pm.parseDeviceIds('0201');
    check('PowerShell 输出单行 0201', eq(pids, ['0201']), pids);
    const pids2 = pm.parseDeviceIds('VID_1209&PID_0201');
    check('裸 VID/PID 串', eq(pids2, ['0201']), pids2);
    const pids3 = pm.parseDeviceIds('   ');
    check('空文本 -> []', eq(pids3, []), pids3);
    const pids4 = pm.parseDeviceIds('VID_1209&PID_a1b2');
    check('小写十六进制 PID 归一大写 A1B2', eq(pids4, ['A1B2']), pids4);
}

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
