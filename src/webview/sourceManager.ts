// webview/sourceManager.ts — 源文件管理面板（单例）
// 列出当前源文件清单，支持添加 / 移除 / 上移 / 下移。
//   scw 模式 → 读 / 写 .scw 的 SourceFile= 行
//   scw-less 模式 → 读 / 写 scmcu.sourceFiles 设置（空列表 = 自动扫描）
// 顺序即编译顺序（XC8 psect 依赖），因此提供上移/下移。
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    findScwFile, parseScw,
    addScwSourceFile, removeScwSourceFile, moveScwSourceFile, listCandidateSources,
} from '../chip';
import { resolveSource } from '../build';

interface SrcFile { name: string; resolved: string; missing: boolean; }
interface PanelData {
    mode: 'scw' | 'scwless';
    scw: string | null;
    scwName: string;
    device: string;
    files: SrcFile[];
}

let panelRef: vscode.WebviewPanel | undefined;

export function showSourceManager(context: vscode.ExtensionContext, workspaceRoot: string, channel: vscode.OutputChannel): void {
    // scw / scw-less 都支持；不再强制要求 .scw
    const load = (): PanelData | null => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const sourceDirsCfg = cfg.get<string[]>('sourceDirs', ['src']);
        const scw = findScwFile(workspaceRoot);
        if (scw) {
            const info = parseScw(scw);
            const files: SrcFile[] = info.sourceFiles.map(name => {
                const r = resolveSource(name, workspaceRoot, sourceDirsCfg);
                return { name, resolved: r ? path.relative(workspaceRoot, r).split(path.sep).join('/') : '', missing: !r };
            });
            return { mode: 'scw', scw, scwName: path.basename(scw), device: info.device || '(未知)', files };
        } else {
            // scw-less：从 scmcu.sourceFiles 读，空则回退到自动扫描
            const dev = cfg.get<string>('device', '') || '';
            if (!dev) {
                vscode.window.showErrorMessage('脱离 .scw 模式：未配置 scmcu.device。请在「设置 → 扩展 → SCMCU」中填写，或用命令面板 "SCMCU: 设置芯片型号"');
                return null;
            }
            const override = (cfg.get<string[]>('sourceFiles', []) || []).filter(s => s && s.trim().length > 0);
            const list = override.length > 0 ? override : listCandidateSources(workspaceRoot, []);
            const files: SrcFile[] = list.map(name => {
                const r = resolveSource(name, workspaceRoot, sourceDirsCfg);
                return { name, resolved: r ? path.relative(workspaceRoot, r).split(path.sep).join('/') : '', missing: !r };
            });
            return { mode: 'scwless', scw: null, scwName: '(脱离 .scw 模式)', device: dev, files };
        }
    };

    // 把当前文件列表写回存储（按 mode 选择 .scw 或 scmcu.sourceFiles）
    const persist = async (files: string[]): Promise<void> => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const scw = findScwFile(workspaceRoot);
        if (scw) {
            // 简化策略：完全覆写 SourceFile= 段（保留行尾其它段）。当前 scw 写入函数是行级 add/remove/move，
            // 顺序调整按 move 实现复杂。改成：先清空原 SourceFile 段，再 add 全部。
            // 但 chip.ts 没有 clearAllSourceFile。改成差量：move 调整到目标顺序。
            // 简化：连续 swap 直到和目标一致。
            const current = parseScw(scw).sourceFiles.slice();
            // 目标：files（按用户当前顺序）
            // 算法：把 current 变换到 files（相同集合、相同顺序）
            // 双向比较：只在必要时移动
            const desired = files.slice();
            // 简单实现：若 current === desired，直接返回；否则 move 逐步调整
            // 先检测差集（必须有相同集合）
            const curSet = new Set(current), desSet = new Set(desired);
            if (curSet.size !== desSet.size || [...curSet].some(x => !desSet.has(x))) {
                throw new Error('源文件集合与 .scw 不一致，请重新打开面板');
            }
            // 用 move 把 current 调整为 desired
            for (let i = 0; i < desired.length; i++) {
                const target = desired[i];
                // 当前 current[i] 应为目标
                if (current[i] === target) continue;
                const fromIdx = current.indexOf(target);
                if (fromIdx < 0) continue;
                // 把 fromIdx 移到 i（通过一系列 swap）
                let j = fromIdx;
                while (j > i) {
                    moveScwSourceFile(scw, current[j], -1);
                    j--;
                }
                while (j < i) {
                    moveScwSourceFile(scw, current[j], 1);
                    j++;
                }
                current.splice(i, 0, current.splice(j, 1)[0]);
            }
        } else {
            // scw-less：直接覆写 scmcu.sourceFiles
            await cfg.update('sourceFiles', files, vscode.ConfigurationTarget.Workspace);
        }
    };

    const render = (): void => {
        const d = load();
        if (d && panelRef) panelRef.webview.html = renderHtml(d);
    };

    // 已有窗口 → 聚焦 + 刷新
    if (panelRef) {
        panelRef.reveal();
        render();
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'scmcu.sourceManager',
        '源文件管理',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
    );
    panelRef = panel;
    panel.onDidDispose(() => {
        watcherScw.dispose();
        watcherSettings.dispose();
        if (panelRef === panel) panelRef = undefined;
    });

    // .scw 改动 → 刷新；工作区 settings.json 改动 → 刷新（scmcu.sourceFiles 外部编辑感知）
    const watcherScw = vscode.workspace.createFileSystemWatcher('**/*.scw');
    watcherScw.onDidChange(() => render());
    watcherScw.onDidCreate(() => render());
    const watcherSettings = vscode.workspace.createFileSystemWatcher('**/.vscode/settings.json');
    watcherSettings.onDidChange(() => render());

    render();

    panel.webview.onDidReceiveMessage(async (msg: any) => {
        const d = load();
        if (!d) return;
        try {
            if (msg.type === 'add') {
                const candidates = listCandidateSources(workspaceRoot, d.files.map(f => f.name));
                const picks = [
                    { label: '浏览文件… (文件对话框)', value: '__browse__' },
                    ...candidates.map(c => ({ label: c, value: c })),
                ];
                const pick = await vscode.window.showQuickPick(picks, { placeHolder: '选择要添加的源文件' });
                if (!pick) return;
                let toAdd: string[] = [];
                if (pick.value === '__browse__') {
                    const uris = await vscode.window.showOpenDialog({
                        canSelectMany: true,
                        defaultUri: vscode.Uri.file(workspaceRoot),
                        filters: { '源文件': ['c', 'asm', 's', 'h'] },
                    });
                    if (!uris) return;
                    toAdd = uris.map(u => path.relative(workspaceRoot, u.fsPath).split(path.sep).join('/'));
                } else {
                    toAdd = [pick.value];
                }
                // 追加到末尾
                const newList = d.files.map(f => f.name).concat(toAdd.filter(n => !d.files.some(f => f.name === n)));
                await persist(newList);
                for (const n of toAdd) channel.appendLine(`[SCMCU] 已添加源文件: ${n}`);
                render();
            } else if (msg.type === 'remove') {
                const newList = d.files.map(f => f.name).filter(n => n !== msg.name);
                await persist(newList);
                channel.appendLine(`[SCMCU] 已移除源文件: ${msg.name}`);
                vscode.window.showInformationMessage(`已移除: ${msg.name}`);
                render();
            } else if (msg.type === 'up' || msg.type === 'down') {
                const dir = msg.type === 'up' ? -1 : 1;
                const cur = d.files.map(f => f.name);
                const i = cur.indexOf(msg.name);
                const j = i + dir;
                if (i < 0 || j < 0 || j >= cur.length) return;
                [cur[i], cur[j]] = [cur[j], cur[i]];
                await persist(cur);
                render();
            }
        } catch (e: any) {
            vscode.window.showErrorMessage('源文件操作失败: ' + e.message);
        }
    });
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderHtml(d: PanelData): string {
    const nonce = Math.random().toString(36).slice(2, 12);
    const isScwLess = d.mode === 'scwless';
    const subLine = isScwLess
        ? `目标: ${d.scwName} ｜ 模式: 脱离 .scw（保存将写入 scmcu.sourceFiles 工作区设置；当前未设置→回退到自动扫描）`
        : `工程: ${d.scwName} ｜ 顺序即编译顺序（上移=更靠前）；修改即时写回 .scw`;
    let rows = '';
    if (d.files.length === 0) {
        rows = '<li class="empty">当前没有源文件，点击上方「+ 添加源文件」</li>';
    } else {
        d.files.forEach((f, i) => {
            const n = d.files.length;
            const upDis = i === 0 ? ' disabled' : '';
            const downDis = i === n - 1 ? ' disabled' : '';
            const pathTxt = f.missing
                ? `<span class="warn">⚠ 未找到（检查 scmcu.sourceDirs 或加子目录前缀）</span>`
                : `<span class="path">${esc(f.resolved)}</span>`;
            rows += `<li>
      <span class="idx">${i + 1}</span>
      <span class="name">${esc(f.name)}</span>
      ${pathTxt}
      <span class="acts">
        <button data-act="up" data-name="${esc(f.name)}"${upDis} title="上移（更靠前）">▲</button>
        <button data-act="down" data-name="${esc(f.name)}"${downDis} title="下移（更靠后）">▼</button>
        <button data-act="remove" data-name="${esc(f.name)}" title="移除">✕</button>
      </span>
    </li>`;
        });
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root { color-scheme: light dark; }
body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  padding: 14px 18px; max-width: 760px;
}
h1 { font-size: 15px; margin: 0 0 4px; }
.sub { opacity: .7; font-size: 12px; margin: 0 0 14px; }
.bar { margin: 0 0 12px; }
button {
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
ul.list { list-style: none; margin: 0; padding: 0; }
li {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px; margin: 0 0 6px;
  border: 1px solid var(--vscode-panel-border); border-radius: 6px;
  background: var(--vscode-editorWidget-background); font-size: 13px;
}
li.empty { opacity: .7; color: var(--vscode-foreground); justify-content: center; }
.idx { width: 22px; text-align: right; opacity: .6; font-family: Consolas, monospace; }
.name { font-weight: 500; min-width: 120px; font-family: Consolas, monospace; }
.path { opacity: .7; flex: 1; word-break: break-all; }
.warn { color: var(--vscode-charts-red); flex: 1; }
.acts { display: flex; gap: 4px; }
.acts button {
  background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
  padding: 3px 9px; font-size: 12px;
}
.acts button:hover:not([disabled]) { background: var(--vscode-button-hoverBackground); color: var(--vscode-button-foreground); }
.acts button[disabled] { opacity: .35; cursor: default; }
</style>
</head>
<body>
<h1>源文件管理 — ${esc(d.device)}</h1>
<p class="sub">${subLine}</p>
<div class="bar"><button id="add">+ 添加源文件</button></div>
<ul class="list">${rows}</ul>
<script nonce="${nonce}">
(function () {
  var vscode = acquireVsCodeApi();
  document.getElementById('add').addEventListener('click', function () {
    vscode.postMessage({ type: 'add' });
  });
  document.querySelectorAll('.acts button').forEach(function (b) {
    b.addEventListener('click', function () {
      vscode.postMessage({ type: b.getAttribute('data-act'), name: b.getAttribute('data-name') });
    });
  });
})();
</script>
</body>
</html>`;
}
