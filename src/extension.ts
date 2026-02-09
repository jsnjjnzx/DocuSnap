import * as vscode from 'vscode';
import * as path from 'path';
import { getChannel, log, debugLog, ASSET_TAG_LINK, normalizeRel, collectWorkspaceFiles } from './utils';
import { getAssetsDir, handleInsertImage, handleInsertDoc } from './assets';
import { handleInsertImageFromClipboard, handleSmartPaste } from './clipboard';
import { getEffectiveCommentMap, getWorkspaceExcludes, handleDeleteCommentTokens } from './config';
import { PinnedPreviewViewProvider, AssetHoverProvider } from './views/preview';
import { LinksTreeProvider, FileNode, LinkNode, handleCleanInvalidLinks, cleanInvalidLinksForFile, handleCleanSingleLink } from './views/linksTree';

function registerAutoRefresh(context: vscode.ExtensionContext, provider: LinksTreeProvider) {
  // 全量刷新防抖
  const debouncedFull = (() => {
    let timer: NodeJS.Timeout | undefined;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => provider.refresh(), 1200);
    };
  })();

  // 增量刷新防抖
  const fileDebounceMap = new Map<string, NodeJS.Timeout>();
  const debouncedFile = (uri: vscode.Uri) => {
    const key = uri.fsPath;
    const old = fileDebounceMap.get(key);
    if (old) clearTimeout(old);
    fileDebounceMap.set(key, setTimeout(() => {
      fileDebounceMap.delete(key);
      provider.refreshFile(uri);
    }, 1200));
  };

  // 文档变更：增量刷新
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => debouncedFile(e.document.uri)),
    vscode.workspace.onDidSaveTextDocument(doc => debouncedFile(doc.uri)),
    vscode.workspace.onDidOpenTextDocument(doc => debouncedFile(doc.uri))
  );

  // 资产目录文件变化：全量刷新
  const ws = vscode.workspace.workspaceFolders?.[0];
  const assetsRoot = getAssetsDir();
  if (ws && assetsRoot) {
    let rel = assetsRoot;
    const root = ws.uri.fsPath;
    if (path.isAbsolute(rel)) rel = path.relative(root, rel);
    const pattern = new vscode.RelativePattern(ws, path.posix.join(rel.replace(/\\/g, '/'), '**/*'));
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(debouncedFull);
    watcher.onDidCreate(debouncedFull);
    watcher.onDidDelete(debouncedFull);
    context.subscriptions.push(watcher);
  }
}

export function activate(context: vscode.ExtensionContext) {
  try {
    const pkg = require('../package.json');
    debugLog('DocuSnap activated', { version: (pkg && pkg.version) || 'unknown', buildTime: (pkg && (pkg as any)._buildTime) || 'dev' });
  } catch { }
  context.subscriptions.push(
    // 新命令 ID（显示为 DocuSnap/注释快贴）
    vscode.commands.registerCommand('docusnap.insertImage', handleInsertImage),
    vscode.commands.registerCommand('docusnap.insertDoc', handleInsertDoc),
    vscode.commands.registerCommand('docusnap.insertImageFromClipboard', handleInsertImageFromClipboard),
    vscode.commands.registerCommand('docusnap.smartPaste', handleSmartPaste),
    vscode.commands.registerCommand('docusnap.cleanInvalidLinks', handleCleanInvalidLinks),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, new AssetHoverProvider())
  );

  // Show log command
  context.subscriptions.push(vscode.commands.registerCommand('docusnap.showLog', () => {
    const ch = getChannel();
    ch.show(true);
  }));

  // Diagnostics command
  context.subscriptions.push(vscode.commands.registerCommand('docusnap.diagnostics', async () => {
    getChannel().show(true);
    const ws = vscode.workspace.workspaceFolders?.[0];
    const assets = getAssetsDir();
    const map = getEffectiveCommentMap();
    const exts = Object.keys(map || {});
    const excludes = getWorkspaceExcludes();
    log('Diagnostics', { root: ws?.uri.fsPath, assetsDir: assets, exts, excludes });
    if (ws) {
      const include = exts.length ? [`**/*.{${exts.join(',')}}`] : ['**/*'];
      const set = await collectWorkspaceFiles(include[0], excludes);
      const sample = set.slice(0, 50).map(u => vscode.workspace.asRelativePath(u));
      debugLog('Diagnostics candidates sample', { count: set.length, sample });
    }
  }));

  // Delete comment token rules for selected extensions
  context.subscriptions.push(vscode.commands.registerCommand('docusnap.deleteCommentTokens', handleDeleteCommentTokens));

  // 侧边固定预览视图与命令
  const previewProvider = new PinnedPreviewViewProvider(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(PinnedPreviewViewProvider.viewId, previewProvider));
  context.subscriptions.push(vscode.commands.registerCommand('docusnap.pinPreview', async (...args: any[]) => {
    try {
      let uri: vscode.Uri | undefined;
      // VS Code 通过 markdown command 链接传参可能是：单个字符串/Uri、数组形式、或多参形式
      const pick = ((): any => {
        if (!args || args.length === 0) return undefined;
        if (args.length === 1) return args[0];
        return args[0];
      })();
      const first = Array.isArray(pick) ? pick[0] : pick;
      if (first instanceof vscode.Uri) uri = first as vscode.Uri;
      else if (typeof first === 'string' && first) { try { uri = vscode.Uri.parse(first as string); } catch { } }
      if (!uri) {
        const editor = vscode.window.activeTextEditor;
        const doc = editor?.document;
        if (doc && editor) {
          const line = doc.lineAt(editor.selection.active.line).text;
          const m = ASSET_TAG_LINK.exec(line);
          if (m) {
            const rel = normalizeRel(m[1] || m[2] || m[3] || m[4]);
            const assetsRoot = getAssetsDir();
            if (assetsRoot) uri = vscode.Uri.file(path.join(assetsRoot, rel));
          }
        }
      }
      if (!uri) return;
      await vscode.commands.executeCommand('workbench.view.extension.docusnap');
      // 关键：聚焦到具体预览视图，触发 resolveWebviewView
      try { await vscode.commands.executeCommand('docusnap.preview.focus'); } catch { }
      // 等待视图准备就绪
      try { await Promise.race([previewProvider.ready, new Promise<void>(r => setTimeout(r, 800))]); } catch { }
      previewProvider.setResource(uri);
    } catch { }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('docusnap.preview.clear', () => previewProvider.clear()));

  // 注册链接树视图
  const linksProvider = new LinksTreeProvider();
  const treeView = vscode.window.createTreeView('docusnap.links', { treeDataProvider: linksProvider });
  context.subscriptions.push(treeView);
  context.subscriptions.push(
    vscode.commands.registerCommand('docusnap.links.refresh', () => linksProvider.refresh()),
    vscode.commands.registerCommand('docusnap.openLinkLocation', async (payload: { uri: vscode.Uri; line: number; character?: number }) => {
      if (!payload || !payload.uri) return;
      const doc = await vscode.workspace.openTextDocument(payload.uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      const pos = new vscode.Position(Math.max(0, payload.line), Math.max(0, payload.character ?? 0));
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }),
    vscode.commands.registerCommand('docusnap.links.cleanFile', async (node?: FileNode | { uri: vscode.Uri }) => {
      const uri = node instanceof FileNode ? node.uri : node?.uri || vscode.window.activeTextEditor?.document.uri;
      if (!uri) return;
      await cleanInvalidLinksForFile(uri);
      linksProvider.refresh();
    }),
    vscode.commands.registerCommand('docusnap.links.cleanSingle', async (node?: LinkNode) => {
      if (!node) return;
      await handleCleanSingleLink(node);
      linksProvider.refresh();
    }),
    vscode.commands.registerCommand('docusnap.links.toggleShowMissing', () => linksProvider.toggleShowMissing()),
    vscode.commands.registerCommand('docusnap.links.search', async () => {
      const q = await vscode.window.showInputBox({ prompt: 'Search links (supports substring)', placeHolder: 'e.g. images/logo or foo.png' });
      linksProvider.setSearchQuery(q?.trim() || undefined);
    })
  );

  // 自动刷新（监听 assets 与文档变化）
  registerAutoRefresh(context, linksProvider);

}

export function deactivate() { }
