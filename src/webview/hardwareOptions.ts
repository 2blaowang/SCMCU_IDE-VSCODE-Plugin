// webview/hardwareOptions.ts — 芯片设置面板（读 cfg 模板 → 交互选择 → 写回 .scw config= + 同步烧录文件）
// 单例：整个扩展只允许一个芯片设置窗口，重复打开时聚焦并刷新内容
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    findScwFile, parseScw, parseCfgTemplate, computeConfigWordsFromBase,
    detectCurrentSelections, writeScwConfig, loadChipParams, CfgTemplate, ScwInfo,
} from '../chip';
import { findCompilerDir } from '../compiler';
import { findScxFiles, patchScxConfigWords } from '../scx';

let panelRef: vscode.WebviewPanel | undefined;

export function showHardwareOptions(context: vscode.ExtensionContext, workspaceRoot: string, channel: vscode.OutputChannel): void {
    // 读取当前工程数据（.scw / 配置模板 / 当前配置字）
    const data = loadPanelData(workspaceRoot);
    if (!data) return;

    // 已有窗口 → 聚焦 + 刷新内容（配置可能已被外部修改）；panelRef 由 onDidDispose 置空
    if (panelRef) {
        panelRef.reveal();
        panelRef.webview.html = renderHtml(data.device, data.tpl, data.current, data.words, data.scwName, data.hexmcu);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'scmcu.hardwareOptions',
        `芯片设置 - ${data.device}`,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
    );
    panelRef = panel;
    panel.onDidDispose(() => { if (panelRef === panel) panelRef = undefined; });

    const render = () => {
        const d = loadPanelData(workspaceRoot);
        if (d && panelRef === panel) {
            panel.webview.html = renderHtml(d.device, d.tpl, d.current, d.words, d.scwName, d.hexmcu);
        }
    };

    panel.webview.html = renderHtml(data.device, data.tpl, data.current, data.words, data.scwName, data.hexmcu);

    panel.webview.onDidReceiveMessage((msg: any) => {
        if (msg.type === 'preview' || msg.type === 'save') {
            // 以 .scw 当前配置字为基底计算，保留模板外的隐藏位
            const w = computeConfigWordsFromBase(data.tpl, msg.selections, data.words, data.hexmcu);
            if (msg.type === 'preview') {
                panel.webview.postMessage({ type: 'previewResult', words: w });
            } else {
                try {
                    writeScwConfig(data.scw, w);
                    const ws = w.map(x => x.toString(16).toUpperCase().padStart(4, '0')).join(',');
                    // 一并写入已有烧录文件(.scx)的配置字区，程序区不动
                    const buildDir = vscode.workspace.getConfiguration('scmcu').get<string>('buildDir', 'build');
                    const patched: string[] = [];
                    for (const scxPath of findScxFiles(workspaceRoot, buildDir)) {
                        if (patchScxConfigWords(scxPath, data.device, w)) patched.push(path.basename(scxPath));
                    }
                    channel.appendLine(`[SCMCU] 芯片设置已保存: config=${ws}, -> ${path.basename(data.scw)}`);
                    if (patched.length > 0) {
                        channel.appendLine(`[SCMCU] 已同步配置字到烧录文件: ${patched.join(', ')}`);
                        vscode.window.showInformationMessage(
                            `芯片设置已写入 ${path.basename(data.scw)}，并同步到烧录文件: ${patched.join(', ')}`,
                        );
                        panel.webview.postMessage({ type: 'saved', words: w, syncedScx: patched });
                    } else {
                        vscode.window.showInformationMessage(`芯片设置已写入 ${path.basename(data.scw)}（未发现 .scx 烧录文件，编译后生效）`);
                        panel.webview.postMessage({ type: 'saved', words: w });
                    }
                } catch (e: any) {
                    vscode.window.showErrorMessage('写入 .scw 失败: ' + e.message);
                }
            }
        } else if (msg.type === 'resetDefault') {
            // 恢复默认值：每个节取 cfg 模板的第一个选项
            try {
                const defaults: Record<string, string> = {};
                for (const sec of Object.keys(data.tpl)) {
                    const opts = Object.keys(data.tpl[sec]);
                    if (opts.length > 0) defaults[sec] = opts[0];
                }
                const w = computeConfigWordsFromBase(data.tpl, defaults, data.words, data.hexmcu);
                writeScwConfig(data.scw, w);
                const buildDir = vscode.workspace.getConfiguration('scmcu').get<string>('buildDir', 'build');
                const patched: string[] = [];
                for (const scxPath of findScxFiles(workspaceRoot, buildDir)) {
                    if (patchScxConfigWords(scxPath, data.device, w)) patched.push(path.basename(scxPath));
                }
                const ws = w.map(x => x.toString(16).toUpperCase().padStart(4, '0')).join(',');
                channel.appendLine(`[SCMCU] 已恢复默认值: config=${ws}, -> ${path.basename(data.scw)}`);
                if (patched.length > 0) {
                    channel.appendLine(`[SCMCU] 已同步配置字到烧录文件: ${patched.join(', ')}`);
                }
                // 重新加载数据并刷新面板（避免 location.reload 白屏）
                const fresh = loadPanelData(workspaceRoot);
                if (fresh && panelRef === panel) {
                    panel.webview.html = renderHtml(fresh.device, fresh.tpl, fresh.current, fresh.words, fresh.scwName, fresh.hexmcu);
                }
                const msg2 = patched.length > 0
                    ? `已恢复默认值，同步到 ${patched.join(', ')}`
                    : '已恢复默认值';
                vscode.window.showInformationMessage(msg2);
            } catch (e: any) {
                vscode.window.showErrorMessage('恢复默认值失败: ' + e.message);
            }
        }
    });
}

interface PanelData {
    scw: string;
    scwName: string;
    device: string;
    tpl: CfgTemplate;
    words: number[];
    current: Record<string, string>;
    hexmcu: number;
}

function loadPanelData(workspaceRoot: string): PanelData | null {
    const scw = findScwFile(workspaceRoot);
    if (!scw) { vscode.window.showErrorMessage('未找到 .scw 工程文件'); return null; }
    const info: ScwInfo = parseScw(scw);
    if (!info.device) { vscode.window.showErrorMessage('.scw 缺少 Device= 行'); return null; }
    const comp = findCompilerDir();
    if (!comp) { vscode.window.showErrorMessage('未找到编译器，请先执行 "SCMCU: 配置编译器目录"'); return null; }

    const cfgPath = path.join(comp.idePath, 'mcu', 'config', info.device + '.cfg');
    if (!fs.existsSync(cfgPath)) { vscode.window.showErrorMessage(`未找到芯片配置模板: ${cfgPath}`); return null; }
    const tpl = parseCfgTemplate(cfgPath);
    const hexmcu = loadChipParams(comp.idePath, info.device).hexmcu;

    const words = info.configWords.length >= 2 ? info.configWords.slice(0, 4) : [hexmcu, hexmcu, hexmcu, hexmcu];
    while (words.length < 4) words.push(0xFFFF);
    const current = detectCurrentSelections(tpl, words);

    return { scw, scwName: path.basename(scw), device: info.device, tpl, words, current, hexmcu };
}

function renderHtml(device: string, tpl: CfgTemplate, current: Record<string, string>, words: number[], scwName: string, hexmcu: number): string {
    const wordStr = words.map(w => w.toString(16).toUpperCase().padStart(4, '0')).join(',');
    const nonce = Math.random().toString(36).slice(2, 12);

    let sectionsHtml = '';
    for (const sec of Object.keys(tpl)) {
        const opts = Object.keys(tpl[sec]);
        if (opts.length === 0) continue;
        let radios = '';
        for (const opt of opts) {
            const checked = current[sec] === opt ? ' checked' : '';
            radios += `<label class="opt"><input type="radio" name="${sec}" value="${opt}"${checked}><span>${opt}</span></label>`;
        }
        sectionsHtml += `<fieldset data-section="${sec}"><legend>${sec}</legend>${radios}</fieldset>`;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${nonce ? `'nonce-${nonce}'` : "'unsafe-inline'"}; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root {
    color-scheme: light dark;
}
body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 20px;
    max-width: 860px;
}
h1 { font-size: 16px; margin: 0 0 4px; }
.sub { opacity: .7; font-size: 12px; margin: 0 0 16px; }
fieldset {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    margin: 0 0 14px;
    padding: 10px 14px;
}
legend { font-weight: 600; font-size: 13px; padding: 0 6px; }
.opt {
    display: inline-flex; align-items: center; gap: 6px;
    margin: 4px 14px 4px 0; padding: 4px 10px;
    border: 1px solid var(--vscode-panel-border); border-radius: 4px;
    cursor: pointer; font-size: 12px;
    background: var(--vscode-editorWidget-background);
}
.opt:hover { border-color: var(--vscode-focusBorder); }
.opt input { accent-color: var(--vscode-focusBorder); }
.opt:has(input:checked) { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.bar {
    position: sticky; bottom: 0;
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 10px 0; background: var(--vscode-editor-background);
    border-top: 1px solid var(--vscode-panel-border);
}
#words {
    font-family: Consolas, monospace; font-size: 13px;
    color: var(--vscode-charts-blue); word-break: break-all;
}
#status { font-size: 12px; opacity: .85; }
button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 6px 18px; cursor: pointer; font-size: 13px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}
</style>
</head>
<body>
<h1>硬件选项配置 — ${device}</h1>
<p class="sub">工程文件: ${scwName} ｜ 修改后点击"保存配置"，将写回 .scw 的 config= 行（IDE 同步生效）</p>
${sectionsHtml}
<div class="bar">
    <button id="save">保存配置</button>
    <button id="reset" class="secondary">恢复默认值</button>
    <span id="words">配置字: ${wordStr}</span>
    <span id="status"></span>
</div>
<script nonce="${nonce}">
(function () {
    var vscode = acquireVsCodeApi();
    function collect() {
        var sel = {};
        document.querySelectorAll('fieldset').forEach(function (fs) {
            var c = fs.querySelector('input:checked');
            if (c) sel[fs.getAttribute('data-section')] = c.value;
        });
        return sel;
    }
    function fmt(w) {
        return w.map(function (x) { return x.toString(16).toUpperCase().padStart(4, '0'); }).join(',');
    }
    document.querySelectorAll('input[type=radio]').forEach(function (r) {
        r.addEventListener('change', function () {
            document.getElementById('status').textContent = '未保存';
            vscode.postMessage({ type: 'preview', selections: collect() });
        });
    });
    document.getElementById('save').addEventListener('click', function () {
        vscode.postMessage({ type: 'save', selections: collect() });
    });
    document.getElementById('reset').addEventListener('click', function () {
        vscode.postMessage({ type: 'resetDefault' });
    });
    window.addEventListener('message', function (e) {
        var m = e.data;
        if (m.type === 'previewResult') {
            document.getElementById('words').textContent = '配置字(预览): ' + fmt(m.words);
        } else if (m.type === 'saved') {
            document.getElementById('words').textContent = '配置字: ' + fmt(m.words);
            var st = '✅ 已写入工程文件';
            if (m.syncedScx && m.syncedScx.length) st += '，并同步到烧录文件: ' + m.syncedScx.join(', ');
            document.getElementById('status').textContent = st;
        }
    });
})();
</script>
</body>
</html>`;
}
