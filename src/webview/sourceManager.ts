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
    setScwSourceFiles, listCandidateSources,
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
            // 整体覆写 SourceFile= 段：新增 / 删除 / 重排 都支持，集合可变化。
            // 不再要求与当前集合一致（旧逻辑在增删时会误报「源文件集合与 .scw 不一致」）。
            setScwSourceFiles(scw, files);
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
            } else if (msg.type === 'reorder') {
                if (!Array.isArray(msg.order) || msg.order.length === 0) return;
                await persist(msg.order.map(String));
                channel.appendLine(`[SCMCU] 已通过拖拽调整源文件顺序`);
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
        : `工程: ${d.scwName} ｜ 顺序即编译顺序（可拖动行或使用 ▲▼ 调整）；修改即时写回 .scw`;
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
            rows += `<li draggable="true" data-name="${esc(f.name)}">
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
# Edit2
.acts button[disabled] { opacity: .35; cursor: default; }
li.dragging { opacity: .4; border-style: dashed; }
li.drag-over { border-color: var(--vscode-focusBorder); box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
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
  var list = document.querySelector('ul.list');

  document.getElementById('add').addEventListener('click', function () {
    vscode.postMessage({ type: 'add' });
  });
  document.querySelectorAll('.acts button').forEach(function (b) {
    b.addEventListener('click', function () {
      vscode.postMessage({ type: b.getAttribute('data-act'), name: b.getAttribute('data-name') });
    });
  });

  // ---- 拖拽排序 ----
  function orderFromDom() {
    return Array.prototype.slice.call(list.querySelectorAll('li[data-name]'))
      .map(function (li) { return li.getAttribute('data-name'); });
  }
  function commitReorder() {
    vscode.postMessage({ type: 'reorder', order: orderFromDom() });
  }
  Array.prototype.slice.call(list.querySelectorAll('li[data-name]')).forEach(function (li) {
    li.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', li.getAttribute('data-name'));
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', function () {
      li.classList.remove('dragging');
      Array.prototype.slice.call(list.querySelectorAll('.drag-over')).forEach(function (x) { x.classList.remove('drag-over'); });
    });
    li.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', function () {
      li.classList.remove('drag-over');
    });
    li.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      li.classList.remove('drag-over');
      var fromName = e.dataTransfer.getData('text/plain');
      var dragged = list.querySelector('li[data-name="' + cssEsc(fromName) + '"]');
      if (!dragged || dragged === li) { return; }
      list.insertBefore(dragged, li);
      commitReorder();
    });
  });
  // 拖到列表空白处 → 放到末尾
  list.addEventListener('dragover', function (e) { e.preventDefault(); });
  list.addEventListener('drop', function (e) {
    e.preventDefault();
    var fromName = e.dataTransfer.getData('text/plain');
    var dragged = list.querySelector('li[data-name="' + cssEsc(fromName) + '"]');
    if (dragged) { list.appendChild(dragged); commitReorder(); }
  });
  // 转义属性选择器中的特殊字符（文件名含引号/方括号等）
  function cssEsc(s) {
    return s.replace(/["\\]/g, '\\$&').replace(/[\\[\]]/g, '\\$&');
  }
})();
</script>
</body>
</html>`;
}
