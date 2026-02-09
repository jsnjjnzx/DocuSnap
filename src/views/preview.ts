import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getAssetsDir } from '../assets';
import { isImageExt, normalizeRel, ASSET_TAG_LINK } from '../utils';

// ---------- Pinned Preview View ----------
export class PinnedPreviewViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'docusnap.preview';
    private _view?: vscode.WebviewView;
    private _current?: vscode.Uri;
    private _readyResolve?: () => void;
    public readonly ready: Promise<void>;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.ready = new Promise<void>(res => { this._readyResolve = res; });
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
        this._view = webviewView;
        const roots: vscode.Uri[] = [];
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (ws) roots.push(ws.uri);
        const assets = getAssetsDir();
        if (assets) roots.push(vscode.Uri.file(assets));
        if (roots.length === 0) roots.push(this.context.extensionUri);
        webviewView.webview.options = { enableScripts: false, localResourceRoots: roots, retainContextWhenHidden: true } as any;
        void this.render();
        if (this._readyResolve) this._readyResolve();
    }

    setResource(uri: vscode.Uri) {
        this._current = uri;
        // 确保本次资源的上级目录被允许访问
        if (this._view) {
            const roots: vscode.Uri[] = [];
            const ws = vscode.workspace.workspaceFolders?.[0];
            if (ws) roots.push(ws.uri);
            const assets = getAssetsDir();
            if (assets) roots.push(vscode.Uri.file(assets));
            try { roots.push(vscode.Uri.file(path.dirname(uri.fsPath))); } catch { /* noop */ }
            this._view.webview.options = { enableScripts: false, localResourceRoots: roots };
        }
        void this.render();
    }

    clear() {
        this._current = undefined;
        void this.render();
    }

    private async render() {
        if (!this._view) return;
        const webview = this._view.webview;
        const csp = `default-src 'none'; img-src ${webview.cspSource} file: data:; style-src 'unsafe-inline' ${webview.cspSource};`;
        const body = await this.renderBody(webview);
        webview.html = `<!DOCTYPE html>
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      :root{color-scheme: light dark}
      body{padding:8px;font:12px var(--vscode-font-family)}
      .hint{color: var(--vscode-descriptionForeground)}
      .path{color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 6px;}
      img{max-width:100%;height:auto;border:1px solid var(--vscode-widgetBorder);}
      pre{white-space:pre-wrap;word-break:break-word;border:1px solid var(--vscode-widgetBorder);padding:8px;border-radius:4px;}
    </style>
  </head>
  <body>${body}</body>
</html>`;
    }

    private async renderBody(webview: vscode.Webview): Promise<string> {
        if (!this._current) {
            return `<div class="hint">点击悬浮窗中的“📌 固定预览”将资源固定到此处。</div>`;
        }
        const uri = this._current;
        const fsPath = uri.fsPath;
        const isImg = isImageExt(fsPath);
        if (isImg) {
            try {
                const buf = await fs.promises.readFile(fsPath);
                const ext = path.extname(fsPath).toLowerCase();
                const mime = ext === '.png' ? 'image/png'
                    : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
                        : ext === '.gif' ? 'image/gif'
                            : ext === '.svg' ? 'image/svg+xml'
                                : ext === '.webp' ? 'image/webp'
                                    : 'application/octet-stream';
                const b64 = buf.toString('base64');
                const name = path.basename(fsPath);
                return `<div class="path">${name}</div><img src="data:${mime};base64,${b64}" alt="asset" />`;
            } catch {
                const asWeb = webview.asWebviewUri(uri);
                return `<img src="${asWeb}" alt="asset" />`;
            }
        }
        if (/(\.md|\.txt)$/i.test(fsPath)) {
            try {
                const txt = await fs.promises.readFile(fsPath, 'utf8');
                const esc = txt.replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[s]!));
                const name = path.basename(fsPath);
                return `<div class="path">${name}</div><pre>${esc}</pre>`;
            } catch {
                return `<div class="hint">无法读取文本预览。</div>`;
            }
        }
        const name = path.basename(fsPath);
        return `<div class="hint">不支持的预览类型：${name}</div>`;
    }
}

export class AssetHoverProvider implements vscode.HoverProvider {
    async provideHover(doc: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        // 优先匹配新行注释格式
        const line = doc.lineAt(position.line).text;
        let rel: string | undefined;
        let range: vscode.Range | undefined;
        // 仅匹配 @link@
        const mLink = ASSET_TAG_LINK.exec(line);
        if (mLink) {
            rel = (mLink[1] || mLink[2] || mLink[3] || mLink[4]);
            const startCol = mLink.index;
            const endCol = startCol + mLink[0].length;
            range = new vscode.Range(new vscode.Position(position.line, startCol), new vscode.Position(position.line, endCol));
        }
        if (!rel || !range) return undefined;

        const assetsRoot = getAssetsDir();
        if (!assetsRoot) return undefined;
        const abs = path.join(assetsRoot, rel);

        const md = new vscode.MarkdownString(undefined, true);
        md.isTrusted = true;
        const uri = vscode.Uri.file(abs);
        const stat = await fs.promises.stat(abs).catch(() => undefined);
        if (!stat) return undefined;

        // 在悬浮内容顶部添加“固定预览”按钮（使用命令链接）
        const pinArg = encodeURIComponent(JSON.stringify([uri.toString()]));
        md.appendMarkdown(`[📌 固定预览](command:docusnap.pinPreview?${pinArg})\n\n`);

        if (isImageExt(rel)) {
            md.appendMarkdown(`![asset](${uri.toString()})`);
        } else if (/(\.md|\.txt)$/i.test(rel)) {
            try {
                const content = await fs.promises.readFile(abs, 'utf8');
                md.appendMarkdown('````markdown\n');
                md.appendMarkdown(content.substring(0, 2000));
                md.appendMarkdown('\n````');
            } catch { }
        } else {
            md.appendMarkdown(`[打开附件](${uri.toString()})`);
        }
        return new vscode.Hover(md, range);
    }
}
