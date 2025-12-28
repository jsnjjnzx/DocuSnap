import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { exec } from 'child_process';

// 仅保留：@link@ 标记，例如：
// // @link@:images/foo.png（注释前缀随语言变化）
// 注意：不要使用 \b 边界，因为 @ 前面通常是注释符或空白，\b 会导致匹配失败。
// 支持半角/全角冒号 & 引号包裹路径
const ASSET_TAG_LINK = /@link@\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`]+))/;

// 规范化相对路径：去掉 ./ 或 / 前缀，\ -> /，Windows 下转小写
function normalizeRel(p: string): string {
  let r = (p || '').trim();
  r = r.replace(/\\/g, '/');
  r = r.replace(/^\.\//, '');
  r = r.replace(/^\/+/, '');
  if (process.platform === 'win32') r = r.toLowerCase();
  return r;
}

// ---- Comment token rules & map ----
// Support syntax like: {c,cpp,h}-{//} or {py,sh}-{#}
function parseCommentTokenRules(rules: string[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!rules || !Array.isArray(rules)) return map;
  for (const raw of rules) {
    const s = String(raw || '').trim();
    if (!s) continue;
    // Try two forms: {left}-{right} and {left}-{ {right} }
    const m = /^\{([^}]+)\}\s*-\s*(?:\{([^}]+)\}|(.+))$/u.exec(s);
    if (!m) continue;
    const left = m[1];
    const right = (m[2] ?? m[3] ?? '').trim();
    if (!right) continue;
    const exts = left.split(',').map(x => x.trim()).filter(Boolean);
    for (const ext of exts) {
      const key = ext.replace(/^\./, '').toLowerCase();
      if (!key) continue;
      map[key] = right;
    }
  }
  return map;
}

function getEffectiveCommentMap(): Record<string, string> {
  // Rules-only: compile rules to ext -> token map
  try {
    const cfg = vscode.workspace.getConfiguration();
    const rulesArr = cfg.get<string[]>('docuSnap.commentTokenRules', []);
    return parseCommentTokenRules(rulesArr);
  } catch {
    return {};
  }
}

function getLineCommentToken(doc: vscode.TextDocument): string {
  const id = doc.languageId;
  // 优先读取配置的白名单映射（按扩展名匹配）
  try {
    const map = getEffectiveCommentMap();
    if (map) {
      const ext = path.extname(doc.fileName).toLowerCase().replace(/^\./, '');
      if (ext && map[ext]) return map[ext];
    }
  } catch {}
  switch (id) {
    case 'python':
    case 'shellscript':
    case 'makefile':
    case 'dockerfile':
    case 'yaml':
    case 'toml':
    case 'r':
    case 'perl':
    case 'ruby':
    case 'coffeescript':
    case 'elixir':
    case 'powershell':
      return '#';
    case 'lua':
    case 'haskell':
    case 'sql':
      return '--';
    case 'matlab':
    case 'erlang':
      return '%';
    default:
      return '//';
  }
}

function getAssetsDir(): string | undefined {
  const cfg = vscode.workspace.getConfiguration();
  const dir = cfg.get<string>('docuSnap.assetsDir', '.vscode/code-assets');
  // 如果是绝对路径，直接使用；否则以工作区根为基准
  if (path.isAbsolute(dir)) return dir;
  const ws = vscode.workspace.workspaceFolders?.[0];
  return ws ? path.join(ws.uri.fsPath, dir) : undefined;
}

// 汇总默认排除 + VS Code 的 files.exclude 与 search.exclude
function getWorkspaceExcludes(): string[] {
  const defaults = ['**/node_modules/**', '**/.git/**', '**/.svn/**', '**/.hg/**', '**/.vscode/**', '**/out/**', '**/dist/**', '**/build/**', '**/coverage/**'];
  const filesCfg = vscode.workspace.getConfiguration('files');
  const searchCfg = vscode.workspace.getConfiguration('search');
  const filesEx = filesCfg.get<Record<string, any>>('exclude') || {};
  const searchEx = searchCfg.get<Record<string, any>>('exclude') || {};
  const pickTrueFiles = (m: Record<string, any>) => Object.entries(m)
    .filter(([, v]) => v === true) // 仅采纳明确为 true 的项，忽略字符串型 when 条件
    .map(([k]) => k);
  const pickTrueSearch = (m: Record<string, any>) => Object.entries(m)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  const merged = new Set<string>([...defaults, ...pickTrueFiles(filesEx), ...pickTrueSearch(searchEx)]);
  return Array.from(merged);
}

// -------- Logging --------
let channel: vscode.OutputChannel | undefined;
function getChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('DocuSnap');
  return channel;
}
function safeToStr(v: any): string {
  try { if (typeof v === 'string') return v; return JSON.stringify(v); } catch { return String(v); }
}
function log(...args: any[]) {
  const ch = getChannel();
  const ts = new Date().toISOString();
  ch.appendLine(`[${ts}] ${args.map(a => safeToStr(a)).join(' ')}`);
}
// 读取配置控制详细日志输出（默认关闭）。开启后将打印候选样本、逐文件扫描、删除明细等调试信息。
function isVerbose(): boolean {
  try {
    return !!vscode.workspace.getConfiguration().get<boolean>('docuSnap.verboseLog', false);
  } catch {
    return false;
  }
}
function debugLog(...args: any[]) { if (isVerbose()) log(...args); }

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function pickFiles(filters?: { [name: string]: string[] }): Promise<vscode.Uri[] | undefined> {
  return vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: true, filters });
}

// 支持按文件自定义重命名：renamer 返回基础文件名（不含扩展名）；返回 undefined/空字符串时沿用原名
async function copyIntoAssets(
  selected: vscode.Uri[],
  subDir?: string,
  renamer?: (src: vscode.Uri, baseName: string, index: number) => Promise<string | undefined>
): Promise<{ rel: string; abs: string }[]> {
  const assetsRoot = getAssetsDir();
  if (!assetsRoot) throw new Error('未找到工作区，无法解析资产目录。');
  const targetRoot = subDir ? path.join(assetsRoot, subDir) : assetsRoot;
  await ensureDir(targetRoot);

  const results: { rel: string; abs: string }[] = [];
  for (let i = 0; i < selected.length; i++) {
    const uri = selected[i];
    const origBase = path.basename(uri.fsPath);
    const ext = path.extname(origBase);
    const baseNameWithoutExt = path.basename(origBase, ext);
    let targetBase = baseNameWithoutExt;
    if (renamer) {
      try {
        const maybe = await renamer(uri, baseNameWithoutExt, i);
        if (maybe && maybe.trim()) targetBase = maybe.trim();
      } catch {}
    }
    // 简单清理非法字符
    targetBase = targetBase.replace(/[\\/:*?"<>|]/g, ' ').trim().replace(/\s+/g, '-');
    if (!targetBase) targetBase = baseNameWithoutExt || 'asset';

    // 确保不覆盖已存在文件：若冲突则追加 -1, -2, ...
    let destAbs = path.join(targetRoot, `${targetBase}${ext}`);
    let cnt = 1;
    while (true) {
      try {
        await fs.promises.access(destAbs, fs.constants.F_OK);
        const tryName = `${targetBase}-${cnt++}${ext}`;
        destAbs = path.join(targetRoot, tryName);
      } catch {
        break;
      }
    }

    await fs.promises.copyFile(uri.fsPath, destAbs);
    const rel = path.relative(assetsRoot, destAbs).replace(/\\/g, '/');
    results.push({ rel, abs: destAbs });
  }
  return results;
}

function insertAtCursor(editor: vscode.TextEditor, text: string) {
  const { selections } = editor;
  editor.edit((builder: vscode.TextEditorEdit) => {
    for (const sel of selections) {
      builder.replace(sel, text);
    }
  });
}

function hasRuleForDocument(doc: vscode.TextDocument): boolean {
  try {
    const map = getEffectiveCommentMap();
    const ext = path.extname(doc.fileName).toLowerCase().replace(/^\./, '');
    return !!(ext && map && map[ext]);
  } catch {
    return false;
  }
}

async function maybePromptConfigureRules(doc?: vscode.TextDocument): Promise<boolean> {
  if (!doc) return true;
  if (hasRuleForDocument(doc)) return true;
  const choice = await vscode.window.showWarningMessage(
    '未找到当前文件扩展名的注释规则。请在设置中配置 docuSnap.commentTokenRules 后再尝试插入。',
    { modal: true },
    '打开设置',
    '取消'
  );
  if (choice === '打开设置') {
    try { await vscode.commands.executeCommand('workbench.action.openSettings', 'docuSnap.commentTokenRules'); } catch {}
  }
  return false; // 阻断式：缺少规则时不继续插入
}

async function handleInsertImage() {
  const picks = await pickFiles({ Images: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] });
  if (!picks || picks.length === 0) return;
  const copied = await copyIntoAssets(picks, 'images');
  const editor = vscode.window.activeTextEditor;
  if (editor) { const ok = await maybePromptConfigureRules(editor.document); if (!ok) return; }
  const prefix = editor ? getLineCommentToken(editor.document) : '//';
  const tags = copied.map((c) => `${prefix} @link@:${c.rel}`).join('\n');
  if (editor) insertAtCursor(editor, tags);
}

async function handleInsertDoc() {
  const picks = await pickFiles({ Documents: ['txt', 'md', 'pdf'] });
  if (!picks || picks.length === 0) return;
  const copied = await copyIntoAssets(picks, 'docs');
  const editor = vscode.window.activeTextEditor;
  if (editor) { const ok = await maybePromptConfigureRules(editor.document); if (!ok) return; }
  const prefix = editor ? getLineCommentToken(editor.document) : '//';
  const tags = copied.map((c) => `${prefix} @link@:${c.rel}`).join('\n');
  if (editor) insertAtCursor(editor, tags);
}

function isImageExt(p: string): boolean {
  return /(\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp)$/i.test(p);
}

// 判断标注的相对路径是否属于 assetsRoot 范围内（防止越级或外部路径）
function isRelInAssets(rel: string, assetsRoot: string): boolean {
  if (!rel || !assetsRoot) return false;
  // 过滤协议/盘符形式（如 http:// 或 C:\）
  if (/^[a-zA-Z]:/.test(rel) || /^[a-zA-Z]+:\/\//.test(rel)) return false;
  try {
    const abs = path.resolve(assetsRoot, rel);
    const root = assetsRoot;
    const relToRoot = path.relative(root, abs);
    if (!relToRoot) return true; // 指向根本身
    // 相对到根超出（以 .. 开头）或是绝对（极端情况）都视为不在范围
    if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return false;
    // 严格确保归属
    const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
    const absN = norm(abs);
    const rootN = norm(path.resolve(root));
    return absN === rootN || absN.startsWith(rootN + path.sep);
  } catch {
    return false;
  }
}

class AssetHoverProvider implements vscode.HoverProvider {
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
      } catch {}
    } else {
      md.appendMarkdown(`[打开附件](${uri.toString()})`);
    }
    return new vscode.Hover(md, range);
  }
}

// ---------- Pinned Preview View ----------
class PinnedPreviewViewProvider implements vscode.WebviewViewProvider {
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
    this.render();
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
    this.render();
  }

  clear() {
    this._current = undefined;
    this.render();
  }

  private render() {
    if (!this._view) return;
    const webview = this._view.webview;
    const csp = `default-src 'none'; img-src ${webview.cspSource} file: data:; style-src 'unsafe-inline' ${webview.cspSource};`;
    const body = this.renderBody(webview);
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

  private renderBody(webview: vscode.Webview): string {
    if (!this._current) {
      return `<div class="hint">点击悬浮窗中的“📌 固定预览”将资源固定到此处。</div>`;
    }
    const uri = this._current;
    const fsPath = uri.fsPath;
    const isImg = isImageExt(fsPath);
    if (isImg) {
      try {
        const buf = fs.readFileSync(fsPath);
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
        const txt = fs.readFileSync(fsPath, 'utf8');
        const esc = txt.replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[s]!));
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

// ---------- Smart Paste ----------
function isWindows(): boolean {
  return process.platform === 'win32';
}

// 检查是否可以使用 Windows 剪贴板功能（原生 Windows 或 WSL）
function canUseWindowsClipboard(): boolean {
  return process.platform === 'win32' || isWSL();
}

// 获取 PowerShell 命令（WSL 中需要使用 powershell.exe）
function getPowerShellCommand(): string {
  if (process.platform === 'win32') {
    return 'powershell';
  }
  if (isWSL()) {
    // 在 WSL 中使用 powershell.exe 调用 Windows PowerShell
    return 'powershell.exe';
  }
  return 'powershell';
}

async function exportClipboardImageWindows(): Promise<string | undefined> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docusnap-'));
  const tmpPng = path.join(tmpDir, `clipboard-${Date.now()}.png`);
  
  // 在 WSL 中需要转换路径为 Windows 格式供 PowerShell 使用
  let savePath = tmpPng;
  if (isWSL()) {
    // 将 WSL 路径转换为 Windows 路径
    savePath = wslPathToWin(tmpPng);
  }
  // 统一使用正斜杠，避免转义问题
  savePath = savePath.replace(/\\/g, '/');
  
  const psScript = [
    '$ErrorActionPreference = "Stop";',
    'Add-Type -AssemblyName System.Windows.Forms;',
    'Add-Type -AssemblyName System.Drawing;',
    'if ([System.Windows.Forms.Clipboard]::ContainsImage()) {',
    '  $img = [System.Windows.Forms.Clipboard]::GetImage();',
    '  $bmp = New-Object System.Drawing.Bitmap $img;',
    `  $bmp.Save('${savePath}', [System.Drawing.Imaging.ImageFormat]::Png);`,
    '  Write-Output "SAVED";',
    '} else {',
    '  Write-Output "NOIMAGE";',
    '}'
  ].join(' ');
  
  const psCmd = getPowerShellCommand();
  return new Promise<string | undefined>((resolve) => {
    exec(`${psCmd} -NoProfile -STA -Command "${psScript}"`, (error, stdout) => {
      if (error) return resolve(undefined);
      if (/SAVED/.test(stdout)) return resolve(tmpPng);
      resolve(undefined);
    });
  });
}

async function readClipboardFileDropListWindows(): Promise<string[] | undefined> {
  const psScript = [
    '$ErrorActionPreference = "SilentlyContinue";',
    'Add-Type -AssemblyName System.Windows.Forms;',
    'if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {',
    '  $list = [System.Windows.Forms.Clipboard]::GetFileDropList();',
    '  Write-Output "FILES";',
    '  foreach ($f in $list) { Write-Output $f }',
    '} else {',
    '  Write-Output "NOFILES";',
    '}'
  ].join(' ');
  
  const psCmd = getPowerShellCommand();
  return new Promise<string[] | undefined>((resolve) => {
    exec(`${psCmd} -NoProfile -STA -Command "${psScript}"`, (error, stdout) => {
      if (error) return resolve(undefined);
      const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
      if (lines[0] !== 'FILES') return resolve(undefined);
      
      // 在 WSL 中，需要将 Windows 路径转换为 WSL 路径
      const paths = lines.slice(1);
      if (isWSL()) {
        return resolve(paths.map(p => {
          // C:\path -> /mnt/c/path
          if (/^[a-zA-Z]:\\/.test(p)) {
            return p.replace(/^([a-zA-Z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
                    .replace(/\\/g, '/');
          }
          return p;
        }));
      }
      resolve(paths);
    });
  });
}

function asWorkspacePathMaybe(p: string): string | undefined {
  if (!p) return undefined;
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let abs = p;
  // 兼容：即使在非 Windows 平台运行（如 WSL），也要把 `D:\` 或 `D:/`、UNC `\\server\share` 识别为绝对路径
  const isWinAbs = /^[a-zA-Z]:[\\\/]/.test(abs) || /^\\\\/.test(abs);
  if (!path.isAbsolute(abs) && !isWinAbs) {
    if (!ws) return undefined;
    abs = path.join(ws, abs);
  }
  return abs;
}

function isImagePath(p: string): boolean {
  return /(\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp)$/i.test(p);
}

function isWSL(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    if (process.env.WSL_DISTRO_NAME) return true;
    const rel = require('os').release?.() || '';
    if (/microsoft/i.test(rel)) return true;
    const fsMod = require('fs');
    if (fsMod.existsSync('/proc/sys/kernel/osrelease')) {
      const txt = fsMod.readFileSync('/proc/sys/kernel/osrelease', 'utf8');
      if (/microsoft/i.test(txt)) return true;
    }
  } catch {}
  return false;
}

function winPathToWSL(p: string): string {
  // d:\dir\file -> /mnt/d/dir/file
  const m = /^([a-zA-Z]):[\\\/](.*)$/.exec(p);
  if (!m) return p;
  const drive = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

// WSL 路径转 Windows 路径
function wslPathToWin(p: string): string {
  // /mnt/d/dir/file -> D:\dir\file
  const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p);
  if (!m) return p;
  const drive = m[1].toUpperCase();
  const rest = m[2].replace(/\//g, '\\');
  return `${drive}:\\${rest}`;
}

function normalizeForStat(p: string): string {
  if (!p) return p;
  if (isWSL() && /^([a-zA-Z]):\\/.test(p)) {
    return winPathToWSL(p);
  }
  return p;
}

async function handleSmartPaste() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const prefix = getLineCommentToken(editor.document);
  // 统一在函数顶部声明候选，以便各分支可提前命中
  let foundType: 'image' | 'files' | 'paths' | undefined;
  let imgTmpPath: string | undefined;
  let fileUris: vscode.Uri[] | undefined;

  // 0) 先快速读取文本剪贴板：如果是普通文本，直接走系统粘贴，避免昂贵的 PowerShell 探测
  try {
    const txt = await vscode.env.clipboard.readText();
    const stripWrappingQuotes = (s: string): string => {
      const t = s.trim();
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
      }
      return t;
    };
    const hasAllowedExt = (s: string): boolean => /\.(png|jpg|jpeg|gif|svg|webp|md|txt|pdf)(\?|#|$)/i.test(s);
    const looksLikeFilePath = (s: string): boolean => {
      const t0 = s.trim();
      if (!t0) return false;
      const t = stripWrappingQuotes(t0);
      if (!t) return false;
      if (/^file:\/\//i.test(t)) return true; // 显式文件 URI
      // Windows 盘符或 UNC（允许 \\ 或 /），仅当包含允许扩展名才视为文件
      if (/^[a-zA-Z]:[\\\/]|^\\\\/.test(t)) return hasAllowedExt(t);
      // POSIX 风格路径（含 /、./、../ 开头），同样要求扩展名
      if (/^(\.|\.\.)?\//.test(t)) return hasAllowedExt(t);
      return false;
    };
    if (txt && txt.trim()) {
      const trimmed = txt.trim();

      // 最优先快速命中：若是允许的后缀并且文件存在，直接作为“路径”候选
      const t = stripWrappingQuotes(trimmed);
      if (hasAllowedExt(t)) {
        let p = t;
        if (/^file:\/\//i.test(p)) {
          try { p = vscode.Uri.parse(p).fsPath; } catch {}
        }
        const abs0 = asWorkspacePathMaybe(p) ?? p;
        const statPath0 = normalizeForStat(abs0);
        try {
          const st = fs.statSync(statPath0);
          if (st.isFile()) {
            foundType = 'paths';
            fileUris = [vscode.Uri.file(statPath0)];
            debugLog('SmartPaste fast-check: early file-exists hit', { input: t, abs: abs0, statPath: statPath0 });
          }
        } catch {}
      }

      const fileish = looksLikeFilePath(trimmed);
      debugLog('SmartPaste fast-check', { text: trimmed.length > 200 ? trimmed.slice(0,200) + '…' : trimmed, fileish, earlyFound: !!foundType });
      // 若文本不像具体文件路径/URI，且也未通过“存在性”快速命中，则直接快速粘贴
      if (!fileish && !foundType) {
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        return;
      }
    }
  } catch { /* ignore and continue */ }

  // 收集候选：优先图片，其次文件列表，最后文本路径
  // 注意：若上面的“存在性快速命中”已设置 foundType，将直接跳过后续昂贵探测
  if (!foundType) {

  if (canUseWindowsClipboard()) {
    // 仅检测是否有图片（不立即导出）
    const hasImg = await (async () => {
      const ps = [
        '$ErrorActionPreference = "SilentlyContinue";',
        'Add-Type -AssemblyName System.Windows.Forms;',
        'if ([System.Windows.Forms.Clipboard]::ContainsImage()) { Write-Output "HAS" } else { Write-Output "NO" }'
      ].join(' ');
      const probe = new Promise<boolean>((resolve) => {
        exec(`powershell -NoProfile -STA -Command "${ps}"`, (err, stdout) => {
          if (err) return resolve(false);
          resolve(/HAS/.test(String(stdout)));
        });
      });
      // 超时保护：避免每次粘贴都被外部进程调用卡住
      const timeout = new Promise<boolean>(res => setTimeout(() => res(false), 150));
      return await Promise.race([probe, timeout]);
    })();
    if (hasImg) {
      foundType = 'image';
    } else {
      // 文件列表也加一个轻量超时保护
      const list = await (async () => {
        const p = readClipboardFileDropListWindows();
        const t = new Promise<undefined>(res => setTimeout(() => res(undefined), 150));
        return (await Promise.race([p, t])) as string[] | undefined;
      })();
      if (list && list.length) {
        const uris: vscode.Uri[] = [];
        for (const f of list) {
          if (!f) continue;
          try {
            if (fs.existsSync(f)) uris.push(vscode.Uri.file(f));
          } catch {}
        }
        if (uris.length) {
          foundType = 'files';
          fileUris = uris;
        }
      }
    }
  }

  if (!foundType) {
    const txt = await vscode.env.clipboard.readText();
    if (txt && txt.trim()) {
      const stripWrappingQuotes = (s: string): string => {
        const t = s.trim();
        if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
          return t.slice(1, -1);
        }
        return t;
      };
  // 仅按换行拆分，避免把包含空格的 Windows 路径拆断
  const candidates = txt.split(/\r?\n/).filter(Boolean).map(stripWrappingQuotes);
      const uris: vscode.Uri[] = [];
      debugLog('SmartPaste text-path: candidates start');
      for (let c of candidates) {
        if (c.startsWith('file://')) {
          try {
            c = vscode.Uri.parse(c).fsPath;
          } catch {}
        }
        const abs = asWorkspacePathMaybe(c);
        if (abs) {
          const statPath = normalizeForStat(abs);
          try {
            const st = fs.statSync(statPath);
            const isFile = st.isFile();
            const allowed = isFile && (isImagePath(abs) || /(\.md|\.txt|\.pdf)$/i.test(abs));
            debugLog('SmartPaste text-path: checked', { input: c, abs, statPath, exists: true, isFile, allowed });
            if (allowed) uris.push(vscode.Uri.file(statPath));
          } catch { /* ignore non-existing or permission issues */ }
          if (!fs.existsSync(statPath)) {
            debugLog('SmartPaste text-path: not exists', { input: c, abs, statPath });
          }
        }
      }
      if (uris.length) {
        foundType = 'paths';
        fileUris = uris;
        debugLog('SmartPaste text-path: found files', uris.map(u => u.fsPath));
      } else {
        debugLog('SmartPaste text-path: no usable files');
      }
    }
  }
  } // end if (!foundType) block

  if (foundType) {
    debugLog('SmartPaste final: foundType', foundType);
    const hint = foundType === 'image' ? '图片' : '文件';
    const choice = await vscode.window.showInformationMessage(
      `检测到剪贴板中有${hint}，是否插入 @link@ 链接？`,
      '插入链接',
      '重命名插入',
      '普通粘贴'
    );
    if (choice === '插入链接' || choice === '重命名插入') {
  // 提示配置规则（若当前扩展未在规则中）；阻断式
  if (editor) { const okRules = await maybePromptConfigureRules(editor.document); if (!okRules) return; }
      const wantRename = (choice === '重命名插入');
      const renamer = wantRename ? async (u: vscode.Uri, base: string) => {
        const ext = path.extname(u.fsPath).toLowerCase();
        const input = await vscode.window.showInputBox({
          prompt: `为 ${path.basename(u.fsPath)} 重命名（不含扩展名 ${ext}）`,
          value: base,
          validateInput: (v) => {
            if (!v.trim()) return '文件名不能为空';
            if (/[\\/:*?"<>|]/.test(v)) return '文件名不能包含 \\ / : * ? " < > |';
            return undefined;
          }
        });
        return input?.trim() || base;
      } : undefined;
      try {
        if (foundType === 'image') {
          // 此时再导出图片
          imgTmpPath = await exportClipboardImageWindows();
          if (!imgTmpPath || !fs.existsSync(imgTmpPath)) throw new Error('无法从剪贴板导出图片');
          const copied = await copyIntoAssets([vscode.Uri.file(imgTmpPath)], 'images', renamer);
          insertAtCursor(editor, copied.map((c) => `${prefix} @link@:${c.rel}`).join('\n'));
        } else {
          const uris = fileUris || [];
          const imgs = uris.filter((u) => isImagePath(u.fsPath));
          const others = uris.filter((u) => !isImagePath(u.fsPath));
          const tags: string[] = [];
          if (imgs.length) {
            const copied = await copyIntoAssets(imgs, 'images', renamer);
            tags.push(...copied.map((c) => `${prefix} @link@:${c.rel}`));
          }
          if (others.length) {
            const copied = await copyIntoAssets(others, 'docs', renamer);
            tags.push(...copied.map((c) => `${prefix} @link@:${c.rel}`));
          }
          if (tags.length) insertAtCursor(editor, tags.join('\n'));
        }
      } finally {
        // 清理临时图片
        if (imgTmpPath) {
          try {
            await fs.promises.unlink(imgTmpPath);
          } catch {}
          try {
            await fs.promises.rm(path.dirname(imgTmpPath), { recursive: true, force: true });
          } catch {}
        }
      }
      return;
    }
    // 用户选择普通粘贴
    debugLog('SmartPaste final: user chose plain paste');
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    return;
  }

  // 未检测到可处理内容，回退到默认粘贴
  debugLog('SmartPaste final: fallback to plain paste');
  await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
}

// ---------- Clean invalid links ----------
async function readFileText(uri: vscode.Uri): Promise<string> {
  try {
    return await fs.promises.readFile(uri.fsPath, 'utf8');
  } catch {
    return '';
  }
}

// 优先读取已打开文档的内存文本（含未保存更改），否则回退到磁盘
async function getTextForUri(uri: vscode.Uri): Promise<string> {
  const opened = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
  if (opened) return opened.getText();
  return await readFileText(uri);
}

async function collectWorkspaceFiles(glob: string, excludes?: string[]): Promise<vscode.Uri[]> {
  const excludeGlob = excludes && excludes.length ? `{${excludes.join(',')}}` : '**/node_modules/**';
  const files = await vscode.workspace.findFiles(glob, excludeGlob);
  return files;
}

function findLinkRangeInDoc(doc: vscode.TextDocument, relNorm: string, nearLine?: number): vscode.Range | undefined {
  const re = /@link@\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`]+))/g;
  const tryLine = (ln: number): vscode.Range | undefined => {
    if (ln < 0 || ln >= doc.lineCount) return undefined;
    const txt = doc.lineAt(ln).text;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) {
      const relRaw = (m[1] || m[2] || m[3] || m[4]);
      if (normalizeRel(relRaw) === relNorm) return new vscode.Range(new vscode.Position(ln, m.index), new vscode.Position(ln, m.index + m[0].length));
    }
    return undefined;
  };
  if (typeof nearLine === 'number') {
    for (let d = 0; d <= 3; d++) {
      const candidates = Array.from(new Set([nearLine - d, nearLine + d]));
      for (const ln of candidates) {
        const r = tryLine(ln);
        if (r) return r;
      }
    }
  }
  for (let ln = 0; ln < doc.lineCount; ln++) {
    const r = tryLine(ln);
    if (r) return r;
  }
  return undefined;
}

async function handleCleanInvalidLinks() {
  // 精简默认日志：不再强制打开日志面板。如需详细信息可手动运行“DocuSnap: Show Log”或开启配置 docuSnap.verboseLog。

  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) {
    vscode.window.showWarningMessage('请先打开一个工作区。');
    return;
  }
  const root = ws.uri.fsPath;
  const assetsRoot = getAssetsDir();
  if (!assetsRoot) {
    vscode.window.showWarningMessage('未配置资产目录。');
    return;
  }
  const assetsRootDir = assetsRoot!; // narrow to string for inner closures
  log('CleanInvalid: start', { root, assetsRootDir });

  // 选择清理范围
  const scope = await vscode.window.showQuickPick([
    { label: '仅当前文件', value: 'file' },
    { label: '整个工作区', value: 'workspace' }
  ], { placeHolder: '选择清理范围' });
  if (!scope) return;
  const scopeVal = (scope as any).value as 'file' | 'workspace';

  // 固定 fast 扫描策略：基于规则解析得到的扩展名生成 include globs，使用默认 exclude，遵守 ignore 文件
  const map = getEffectiveCommentMap();
  const exts = Object.keys(map || {});
  const includeGlobs = exts.length ? [`**/*.{${exts.join(',')}}`] : ['**/*'];
  const excludeGlobs = getWorkspaceExcludes();
  const respectIgnore = true;
  debugLog('Config', { includeGlobs, excludeGlobs, respectIgnore, scanMode: 'fast' });

  // 1) 借助 ripgrep：先用 findTextInFiles 快速定位包含 @link@: 的文件，再精确解析
  function unionGlob(globs: string[] | undefined): string | undefined {
    if (!globs || globs.length === 0) return undefined;
    if (globs.length === 1) return globs[0];
    return `{${globs.join(',')}}`;
  }

  let texts: vscode.Uri[] = [];
  if (scopeVal === 'file') {
    const cur = vscode.window.activeTextEditor?.document.uri;
    if (cur) texts = [cur];
    debugLog('Scope=file', { file: cur?.fsPath });
  } else {
    debugLog('Collect via findFiles', { includeGlobs, excludeGlobs });
    const includeList = includeGlobs && includeGlobs.length ? includeGlobs : ['**/*'];
    const excludeList = excludeGlobs && excludeGlobs.length ? excludeGlobs : ['**/node_modules/**'];
    const sets = await Promise.all(includeList.map(g => collectWorkspaceFiles(g, excludeList)));
    const mapSet = new Map<string, vscode.Uri>();
    for (const arr of sets) for (const u of arr) mapSet.set(u.fsPath, u);
    texts = Array.from(mapSet.values());
    debugLog('Candidates from findFiles', texts.length);
    if (texts.length > 0) {
      const sample = texts.slice(0, 500).map(u => u.fsPath);
      debugLog('Candidates sample', { count: sample.length, files: sample });
      if (texts.length > 500) debugLog('Candidates sample truncated', texts.length - 500);
    }
    if (texts.length === 0) {
      // 兜底：扩大 include 到全量
      debugLog('FindFiles got zero results -> widen to all');
      const setsAll = await Promise.all(['**/*'].map(g => collectWorkspaceFiles(g, excludeList)));
      const mapAll = new Map<string, vscode.Uri>();
      for (const arr of setsAll) for (const u of arr) mapAll.set(u.fsPath, u);
      texts = Array.from(mapAll.values());
      debugLog('Candidates after widen', texts.length);
    }
    // 合并已打开文档
    if (vscode.workspace.textDocuments.length) {
      const add = new Map<string, vscode.Uri>();
      for (const u of texts) add.set(u.fsPath, u);
      for (const d of vscode.workspace.textDocuments) if (d.uri.scheme === 'file') add.set(d.uri.fsPath, d.uri);
      const before = texts.length;
      texts = Array.from(add.values());
      debugLog('Merged opened docs', { before, after: texts.length });
    }
  }
  if (scopeVal === 'file' && texts.length === 0) {
    vscode.window.showInformationMessage('未找到当前活动文件。');
    return;
  }
  const linkSet = new Set<string>(); // 规范化后的集合
  const fileToLinks = new Map<string, { range: vscode.Range; relRaw: string; relNorm: string; uri: vscode.Uri; line: number }[]>();

  // 并发限制，避免一次性打开太多文件
  const concurrency = Math.max(2, os.cpus()?.length ?? 4);
  const queue = [...texts];
  const verboseList = isVerbose() && texts.length <= 300; // 仅在详细模式时记录逐文件扫描
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '解析链接…', cancellable: true }, async (progress) => {
    let processed = 0;
    async function worker() {
      while (queue.length) {
        const uri = queue.shift()!;
        if (uri.fsPath.includes(`${path.sep}node_modules${path.sep}`)) continue;
        try {
          const content = await getTextForUri(uri);
          const re = /@link@\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`]+))/g;
          let m: RegExpExecArray | null;
          const matches: { idx: number; len: number; relRaw: string; relNorm: string }[] = [];
          while ((m = re.exec(content))) {
            const relRaw = (m[1] || m[2] || m[3] || m[4]);
            const relNorm = normalizeRel(relRaw);
            if (!isRelInAssets(relNorm, assetsRootDir)) continue;
            linkSet.add(relNorm);
            matches.push({ idx: m.index, len: m[0].length, relRaw, relNorm });
          }
          if (verboseList || (isVerbose() && matches.length)) debugLog('Scan file', { file: uri.fsPath, matches: matches.length });
          if (matches.length) {
            const doc = await vscode.workspace.openTextDocument(uri);
            for (const mm of matches) {
              const start = doc.positionAt(mm.idx);
              const range = new vscode.Range(start, doc.positionAt(mm.idx + mm.len));
              if (!fileToLinks.has(uri.fsPath)) fileToLinks.set(uri.fsPath, []);
              fileToLinks.get(uri.fsPath)!.push({ range, relRaw: mm.relRaw, relNorm: mm.relNorm, uri, line: start.line });
            }
          }
        } catch {}
        processed++;
        if (processed % 50 === 0) progress.report({ message: `已解析 ${processed}/${texts.length} 个文件…` });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  });

  // 2) 资产目录下的所有文件（规范化）
  async function listAllFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(d: string) {
      const ents = await fs.promises.readdir(d, { withFileTypes: true });
      for (const it of ents) {
        const p = path.join(d, it.name);
        if (it.isDirectory()) await walk(p);
        else out.push(p);
      }
    }
    try {
      await walk(dir);
    } catch {}
    return out;
  }
  const allAssetFiles = scopeVal === 'workspace' ? await listAllFiles(assetsRootDir) : [];
  const assetRelSet = new Set(allAssetFiles.map((abs) => normalizeRel(path.relative(assetsRootDir, abs).replace(/\\/g, '/'))));
  log('Assets files count', allAssetFiles.length);
  if (allAssetFiles.length > 0) {
    const sample = allAssetFiles.slice(0, 100).map(p => path.relative(assetsRootDir, p).replace(/\\/g, '/'));
    debugLog('Assets files sample', { count: sample.length, files: sample });
    if (allAssetFiles.length > 100) debugLog('Assets files sample truncated', allAssetFiles.length - 100);
  }

  // 3) 计算坏链接与孤立附件
  // 文件存在性检查：
  // - 在 workspace 范围：优先使用 assetRelSet（O(1)），若未命中则回退到 fs.stat 双保险；
  // - 在 file 范围：直接使用 fs.stat 检测。
  async function assetExists(relNorm: string): Promise<boolean> {
    if (scopeVal === 'workspace') {
      if (assetRelSet.has(relNorm)) return true;
      // 罕见情况下集合遗漏，兜底直接检查文件系统
    }
    const abs = path.join(assetsRootDir, relNorm);
    try {
      const st = await fs.promises.stat(abs);
      return st.isFile() || st.isDirectory();
    } catch {
      return false;
    }
  }

  const badLinks: { label: string; detail: string; action: 'unlink'; payload: { uri: vscode.Uri; range: vscode.Range; relNorm: string; line: number } }[] = [];
  const allLinkItems: { filePath: string; link: { range: vscode.Range; relRaw: string; relNorm: string; uri: vscode.Uri; line: number } }[] = [];
  for (const [filePath, links] of fileToLinks.entries()) {
    for (const l of links) allLinkItems.push({ filePath, link: l });
  }
  const existConcurrency = Math.max(4, os.cpus()?.length ?? 4);
  const existQueue = [...allLinkItems];
  await Promise.all(Array.from({ length: existConcurrency }, async () => {
    while (existQueue.length) {
      const item = existQueue.shift()!;
      const { filePath, link: l } = item;
      const exists = await assetExists(l.relNorm);
      if (!exists) {
        badLinks.push({
          label: `删除坏链接: ${l.relRaw}`,
          detail: `引用文件: ${path.relative(root, filePath).replace(/\\/g, '/')}`,
          action: 'unlink',
          payload: { uri: l.uri, range: l.range, relNorm: l.relNorm, line: l.line },
        });
      }
    }
  }));
  log('Bad links', badLinks.length);
  if (badLinks.length > 0) {
    const sample = badLinks.slice(0, 20).map(b => ({ file: b.detail, rel: (b as any).payload?.relNorm }));
    debugLog('Bad links sample', sample);
  }
  const orphanAssets: { label: string; detail: string; action: 'delete'; payload: { abs: string } }[] = [];
  for (const abs of allAssetFiles) {
    const relNorm = normalizeRel(path.relative(assetsRoot, abs).replace(/\\/g, '/'));
    if (!linkSet.has(relNorm)) {
      orphanAssets.push({ label: `删除孤立附件: ${path.relative(assetsRoot, abs).replace(/\\/g, '/')}`, detail: `附件路径: ${abs}`, action: 'delete', payload: { abs } });
    }
  }
  log('Orphan assets', orphanAssets.length);
  if (orphanAssets.length > 0) {
    const sample = orphanAssets.slice(0, 20).map(a => a.payload.abs);
    debugLog('Orphan assets sample', sample);
  }

  if (badLinks.length === 0 && orphanAssets.length === 0) {
    vscode.window.showInformationMessage('未发现无效链接或孤立附件。');
    return;
  }

  // 4) 选择要处理的项
  const picks = await vscode.window.showQuickPick(
    scopeVal === 'workspace' ? [...badLinks, ...orphanAssets] : [...badLinks],
    {
      canPickMany: true,
      matchOnDetail: true,
      placeHolder: scopeVal === 'workspace'
        ? '选择要清理的项目（可多选）。坏链接：只删除链接文本；孤立附件：删除文件（仅限 assetsDir）。'
        : '选择要清理的坏链接（仅当前文件，删除链接文本）。'
    }
  );
  if (!picks || picks.length === 0) return;

  const ok = await vscode.window.showWarningMessage('确认删除选中的项目吗？不可撤销（附件会被删除，链接文本将被移除）', { modal: true }, '确认删除', '取消');
  if (ok !== '确认删除') return;

  // 5) 执行删除：分批（按文件）应用 WorkspaceEdit，并展示细粒度进度
  const unlinkItems = picks.filter((p: any) => p.action === 'unlink') as Array<{ action: 'unlink'; payload: { uri: vscode.Uri; range: vscode.Range } }>;
  const fileDelItems = picks.filter((p: any) => p.action === 'delete') as Array<{ action: 'delete'; payload: { abs: string } }>;
  const totalUnlink = unlinkItems.length;
  const totalFileDel = fileDelItems.length;
  const totalAll = totalUnlink + totalFileDel;

  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  sb.name = 'DocuSnap 清理进度';
  const updateSB = (done: number, total: number) => {
    sb.text = `DocuSnap: 已删除 ${done}/${total}（待删除 ${Math.max(0, total - done)}）`;
    sb.show();
  };

  let deletedCount = 0;
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在删除选中项…', cancellable: true }, async (progress, token) => {
      const report = () => {
        progress.report({ message: `已删除 ${deletedCount}/${totalAll}（待删除 ${Math.max(0, totalAll - deletedCount)}）` });
        updateSB(deletedCount, totalAll);
      };
      report();

      // 5.1 文本链接删除：按文件分组，避免文档光标移动和编辑器打开
      const byFile = new Map<string, Array<{ uri: vscode.Uri; range: vscode.Range }>>();
      for (const it of unlinkItems) {
        const { uri, range } = it.payload;
        const key = uri.fsPath;
        if (!byFile.has(key)) byFile.set(key, []);
        byFile.get(key)!.push({ uri, range });
      }
      for (const [fsPath, arr] of byFile.entries()) {
        if (token.isCancellationRequested) break;
        try {
          const uri = vscode.Uri.file(fsPath);
          const doc = await vscode.workspace.openTextDocument(uri);
          // 计算扩展删除范围
          const expanded: vscode.Range[] = arr.map(({ range }) => {
            const line = doc.lineAt(range.start.line);
            const lineText = line.text;
            const before = lineText.slice(0, range.start.character);
            const after = lineText.slice(range.end.character);
            let startCol = range.start.character;
            const leftMatch = before.match(/(\s*)((?:\/\/)|#|--|;|%)\s*$/);
            if (leftMatch) startCol = before.length - leftMatch[0].length; else if (/^\s*$/.test(before)) startCol = 0;
            let endCol = range.end.character;
            if (/^\s*$/.test(after)) endCol = lineText.length;
            return new vscode.Range(new vscode.Position(range.start.line, startCol), new vscode.Position(range.end.line, endCol));
          });
          // 单次 WorkspaceEdit，避免偏移
          const we = new vscode.WorkspaceEdit();
          for (const r of expanded) we.delete(uri, r);
          await vscode.workspace.applyEdit(we);
          await doc.save();
          deletedCount += arr.length;
          debugLog('Deleted links in file', { file: fsPath, count: arr.length });
        } catch {
          // 忽略单文件失败，继续其他项
        }
        report();
      }

      // 5.2 附件删除：逐个 unlink，随删随报进度
      for (const it of fileDelItems) {
        if (token.isCancellationRequested) break;
        try { await fs.promises.unlink(it.payload.abs); } catch {}
        deletedCount += 1;
        debugLog('Deleted asset file', it.payload.abs);
        report();
      }
    });
  } finally {
    sb.hide();
    sb.dispose();
  }

  const msg = deletedCount >= totalAll
    ? '清理完成。'
    : `已取消。已删除 ${deletedCount}/${totalAll}`;
  vscode.window.showInformationMessage(msg);
  log('CleanInvalid: end', { deletedCount, totalAll });
}

// ---------- Clipboard image/document insert command (Windows) ----------
async function handleInsertImageFromClipboard() {
  if (!canUseWindowsClipboard()) {
    vscode.window.showWarningMessage('当前仅在 Windows 或 WSL 环境下支持从剪贴板插入图片/文档。');
    return;
  }

  // 1) 优先处理剪贴板中的文件列表（可包含图片与非图片文件）
  const fileList = await readClipboardFileDropListWindows();
  if (fileList && fileList.length) {
    const uris: vscode.Uri[] = [];
    for (const f of fileList) {
      if (!f) continue;
      try {
        if (fs.existsSync(f)) uris.push(vscode.Uri.file(f));
      } catch {}
    }
    if (uris.length) {
      const editor = vscode.window.activeTextEditor;
  if (editor) { const ok = await maybePromptConfigureRules(editor.document); if (!ok) return; }
  const prefix = editor ? getLineCommentToken(editor.document) : '//';
      const wantRename = await vscode.window.showQuickPick(['重命名附件', '跳过重命名'], { placeHolder: '是否为即将插入的附件重命名？' });
      const renamer = (wantRename === '重命名附件') ? async (u: vscode.Uri, base: string) => {
        const ext = path.extname(u.fsPath).toLowerCase();
        const input = await vscode.window.showInputBox({
          prompt: `为 ${path.basename(u.fsPath)} 重命名（不含扩展名 ${ext}）`,
          value: base,
          validateInput: (v) => {
            if (!v.trim()) return '文件名不能为空';
            if (/[\\/:*?"<>|]/.test(v)) return '文件名不能包含 \\ / : * ? " < > |';
            return undefined;
          }
        });
        return input?.trim() || base;
      } : undefined;
      const imgs = uris.filter(u => isImagePath(u.fsPath));
      const others = uris.filter(u => !isImagePath(u.fsPath));
      const tags: string[] = [];
      if (imgs.length) {
        const copied = await copyIntoAssets(imgs, 'images', renamer);
        tags.push(...copied.map(c => `${prefix} @link@:${c.rel}`));
      }
      if (others.length) {
        const copied = await copyIntoAssets(others, 'docs', renamer);
        tags.push(...copied.map(c => `${prefix} @link@:${c.rel}`));
      }
      if (editor && tags.length) insertAtCursor(editor, tags.join('\n'));
      if (!tags.length) vscode.window.showInformationMessage('剪贴板文件不包含可处理的图片或文档类型。');
      return;
    }
  }

  // 2) 若无文件列表，则尝试导出剪贴板图片
  let tmp: string | undefined;
  try {
    tmp = await exportClipboardImageWindows();
    if (!tmp) {
      vscode.window.showWarningMessage('剪贴板中没有可用的图片或文件。');
      return;
    }
    const wantRename = await vscode.window.showQuickPick(['重命名附件', '跳过重命名'], { placeHolder: '是否为即将插入的附件重命名？' });
    const renamer = (wantRename === '重命名附件') ? async (u: vscode.Uri, base: string) => {
      const ext = path.extname(u.fsPath).toLowerCase();
      const input = await vscode.window.showInputBox({
        prompt: `为 ${path.basename(u.fsPath)} 重命名（不含扩展名 ${ext}）`,
        value: base,
        validateInput: (v) => {
          if (!v.trim()) return '文件名不能为空';
          if (/[\\/:*?"<>|]/.test(v)) return '文件名不能包含 \\ / : * ? " < > |';
          return undefined;
        }
      });
      return input?.trim() || base;
    } : undefined;
    const copied = await copyIntoAssets([vscode.Uri.file(tmp)], 'images', renamer);
    const editor = vscode.window.activeTextEditor;
  if (editor) { const ok = await maybePromptConfigureRules(editor.document); if (!ok) return; }
  const prefix = editor ? getLineCommentToken(editor.document) : '//';
    const tags = copied.map((c) => `${prefix} @link@:${c.rel}`).join('\n');
    if (editor) insertAtCursor(editor, tags);
  } finally {
    if (tmp) {
      try { await fs.promises.unlink(tmp); } catch {}
      try { await fs.promises.rm(path.dirname(tmp), { recursive: true, force: true }); } catch {}
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  try {
    const pkg = require('../package.json');
    debugLog('DocuSnap activated', { version: (pkg && pkg.version) || 'unknown', buildTime: (pkg && (pkg as any)._buildTime) || 'dev' });
  } catch {}
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
  context.subscriptions.push(vscode.commands.registerCommand('docusnap.deleteCommentTokens', async () => {
    try {
      const cfg = vscode.workspace.getConfiguration();
      const rulesArr = cfg.get<string[]>('docuSnap.commentTokenRules', []);
      // Parse rules into structures: collect ext set and a parsed list for editing
      type RuleLine = { lefts: string[]; right: string };
      const parsed: RuleLine[] = [];
      const allExts = new Map<string, string>(); // ext -> token (last wins)
      for (const raw of rulesArr) {
        const s = String(raw || '').trim();
        if (!s) continue;
        const m = /^\{([^}]+)\}\s*-\s*(?:\{([^}]+)\}|(.+))$/u.exec(s);
        if (!m) continue;
        const left = m[1];
        const right = (m[2] ?? m[3] ?? '').trim();
        if (!right) continue;
        const exts = left.split(',').map(x => x.trim()).filter(Boolean).map(x => x.replace(/^\./, '').toLowerCase());
        parsed.push({ lefts: exts, right });
        for (const e of exts) allExts.set(e, right);
      }
      const keys = Array.from(allExts.keys());
      if (!keys.length) {
        vscode.window.showInformationMessage('没有可删除的规则扩展名。');
        return;
      }
      const picks = await vscode.window.showQuickPick(
        keys.map(k => ({ label: k, description: allExts.get(k) })),
        { canPickMany: true, placeHolder: '选择要从规则中移除的扩展名（可多选）' }
      );
      if (!picks || picks.length === 0) return;
      const toDel = new Set(picks.map(p => p.label.replace(/^\./, '').toLowerCase()));

      // Build next rules: remove selected exts from each line; drop empty lines
      const nextRules: string[] = [];
      for (const line of parsed) {
        const lefts = line.lefts.filter(e => !toDel.has(e));
        if (lefts.length === 0) continue;
        nextRules.push(`{${lefts.join(',')}}-{${line.right}}`);
      }

      // Preserve configuration target (folder/workspace/global)
      const inspect = cfg.inspect<string[]>('docuSnap.commentTokenRules');
      const target: vscode.ConfigurationTarget | undefined = (() => {
        if (!inspect) return vscode.ConfigurationTarget.Workspace;
        if (inspect.workspaceFolderValue) return vscode.ConfigurationTarget.WorkspaceFolder;
        if (inspect.workspaceValue) return vscode.ConfigurationTarget.Workspace;
        return vscode.ConfigurationTarget.Global;
      })();

      const base: string[] = (target === vscode.ConfigurationTarget.WorkspaceFolder && inspect?.workspaceFolderValue)
        || (target === vscode.ConfigurationTarget.Workspace && inspect?.workspaceValue)
        || (target === vscode.ConfigurationTarget.Global && inspect?.globalValue)
        || rulesArr;

      // If no parsed lines (e.g., all were invalid), but there were base lines, we should set to [] when deletions selected
      const finalRules = parsed.length ? nextRules : [];
      await cfg.update('docuSnap.commentTokenRules', finalRules, target);
      vscode.window.showInformationMessage(`已从规则中移除 ${toDel.size} 个扩展名。`);
    } catch (e) {
      vscode.window.showErrorMessage('删除规则失败：' + (e as Error).message);
    }
  }));

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
      else if (typeof first === 'string' && first) { try { uri = vscode.Uri.parse(first as string); } catch {} }
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
      try { await vscode.commands.executeCommand('docusnap.preview.focus'); } catch {}
      // 等待视图准备就绪
      try { await Promise.race([previewProvider.ready, new Promise<void>(r => setTimeout(r, 800))]); } catch {}
      previewProvider.setResource(uri);
    } catch {}
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
      try {
        const doc = await vscode.workspace.openTextDocument(node.parent);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const relNorm = normalizeRel(node.relRaw);
        const range = findLinkRangeInDoc(doc, relNorm, node.line);
        if (!range) return;
        // 扩展删除范围（与批量清理一致）
        const line = doc.lineAt(range.start.line);
        const lineText = line.text;
        const before = lineText.slice(0, range.start.character);
        const after = lineText.slice(range.end.character);
        let startCol = range.start.character;
        const leftMatch = before.match(/(\s*)((?:\/\/)|#|--|;|%)\s*$/);
        if (leftMatch) {
          startCol = before.length - leftMatch[0].length;
        } else if (/^\s*$/.test(before)) {
          startCol = 0;
        }
        let endCol = range.end.character;
        if (/^\s*$/.test(after)) endCol = lineText.length;
        const delRange = new vscode.Range(new vscode.Position(range.start.line, startCol), new vscode.Position(range.end.line, endCol));
        await editor.edit(b => b.delete(delRange));
        await doc.save();
      } finally {
        linksProvider.refresh();
      }
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

export function deactivate() {}

// ---------------- Links Tree View ----------------
type TreeNode = FileNode | LinkNode;

class FileNode extends vscode.TreeItem {
  constructor(public readonly uri: vscode.Uri, public readonly count: number) {
    super(vscode.workspace.asRelativePath(uri), vscode.TreeItemCollapsibleState.Collapsed);
    this.resourceUri = uri;
    this.iconPath = new vscode.ThemeIcon('file');
    this.description = `${count}`;
    this.contextValue = 'docusnap.file';
  }
}

class LinkNode extends vscode.TreeItem {
  constructor(
    public readonly parent: vscode.Uri,
    public readonly relRaw: string,
    public readonly line: number,
    public readonly exists: boolean
  ) {
    super(`@link@: ${relRaw}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(exists ? 'link' : 'warning');
    this.description = exists ? '' : 'missing';
    this.command = {
      command: 'docusnap.openLinkLocation',
      title: 'Open Link Location',
      arguments: [{ uri: parent, line }]
    };
    this.tooltip = `${vscode.workspace.asRelativePath(parent)}:${line + 1}`;
    this.contextValue = exists ? 'docusnap.link' : 'docusnap.link.missing';
  }
}

class LinksTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cache: Map<string, LinkNode[]> = new Map();
  private showOnlyMissing = false;
  private searchQuery: string | undefined;

  refresh(): void {
    this.cache.clear();
    this._onDidChangeTreeData.fire();
  }

  toggleShowMissing(): void {
    this.showOnlyMissing = !this.showOnlyMissing;
    this._onDidChangeTreeData.fire();
  }

  setSearchQuery(q?: string): void {
    this.searchQuery = q;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem { return element; }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      // 根：文件节点
      await this.ensureScanned();
      const items: FileNode[] = [];
      for (const [fsPath, links] of this.cache.entries()) {
        items.push(new FileNode(vscode.Uri.file(fsPath), links.length));
      }
      items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()))
      return items;
    }
    if (element instanceof FileNode) {
      let list = this.cache.get(element.uri.fsPath) || [];
      if (this.showOnlyMissing) list = list.filter(n => !n.exists);
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        list = list.filter(n => n.relRaw.toLowerCase().includes(q));
      }
      // 以行号排序
      return list.sort((a, b) => a.line - b.line);
    }
    return [];
  }

  private async ensureScanned(): Promise<void> {
    if (this.cache.size > 0) return;
    const result = await scanLinksAcrossWorkspace();
    this.cache = result;
  }
}

async function scanLinksAcrossWorkspace(): Promise<Map<string, LinkNode[]>> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  const out = new Map<string, LinkNode[]>();
  if (!ws) return out;

  const map = getEffectiveCommentMap();
  const exts = Object.keys(map || {});
  const includeGlobs = exts.length ? [`**/*.{${exts.join(',')}}`] : ['**/*'];
  const excludeGlobs = getWorkspaceExcludes();

  const assetsRoot = getAssetsDir();
  const assetsRootDir = assetsRoot || '';

  // 收集候选文件，并合并已打开文档
  const candidateSets = await Promise.all(includeGlobs.map(g => collectWorkspaceFiles(g, excludeGlobs)));
  const fileSet = new Map<string, vscode.Uri>();
  for (const arr of candidateSets) for (const u of arr) fileSet.set(u.fsPath, u);
  for (const d of vscode.workspace.textDocuments) if (d.uri.scheme === 'file') fileSet.set(d.uri.fsPath, d.uri);
  const texts = Array.from(fileSet.values());

  const re = /@link@\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`]+))/g;
  const concurrency = Math.max(2, os.cpus()?.length ?? 4);
  const queue = [...texts];

  async function fileExistsAbs(abs: string): Promise<boolean> {
    try { const st = await fs.promises.stat(abs); return st.isFile() || st.isDirectory(); } catch { return false; }
  }

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const uri = queue.shift()!;
      if (uri.fsPath.includes(`${path.sep}node_modules${path.sep}`)) continue;
      try {
        const content = await getTextForUri(uri);
        let m: RegExpExecArray | null;
        const found: { relRaw: string; line: number; exists: boolean }[] = [];
        while ((m = re.exec(content))) {
          const relRaw = (m[1] || m[2] || m[3] || m[4]);
          const relNorm = normalizeRel(relRaw);
          if (!assetsRootDir || !isRelInAssets(relNorm, assetsRootDir)) continue;
          const line = content.slice(0, m.index).split(/\r?\n/).length - 1;
          const abs = assetsRootDir ? path.join(assetsRootDir, relNorm) : '';
          const exists = assetsRootDir ? await fileExistsAbs(abs) : false;
          found.push({ relRaw, line, exists });
        }
        const items = out.get(uri.fsPath) || [];
        for (const f of found) items.push(new LinkNode(uri, f.relRaw, f.line, f.exists));
        if (items.length) out.set(uri.fsPath, items);
      } catch {}
    }
  }));

  return out;
}

// 针对单个文件执行清理坏链接
async function cleanInvalidLinksForFile(uri: vscode.Uri) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const content = doc.getText();
  const assetsRoot = getAssetsDir();
  if (!assetsRoot) {
    vscode.window.showWarningMessage('未配置资产目录。');
    return;
  }
  const re = /@link@\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`]+))/g;
  let m: RegExpExecArray | null;
  const picks: { label: string; detail: string; range: vscode.Range }[] = [];
  while ((m = re.exec(content))) {
    const relRaw = (m[1] || m[2] || m[3] || m[4]);
    const relNorm = normalizeRel(relRaw);
    if (!isRelInAssets(relNorm, assetsRoot)) continue;
    const line = content.slice(0, m.index).split(/\r?\n/).length - 1;
    const abs = path.join(assetsRoot, relNorm);
    const exists = await fs.promises.stat(abs).then(() => true).catch(() => false);
    if (!exists) {
      const range = findLinkRangeInDoc(doc, relNorm, line) || new vscode.Range(doc.positionAt(m.index), doc.positionAt(m.index + m[0].length));
      picks.push({ label: `删除坏链接: ${relRaw}`, detail: `${vscode.workspace.asRelativePath(uri)}:${line + 1}`, range });
    }
  }
  if (picks.length === 0) {
    vscode.window.showInformationMessage('该文件未发现坏链接。');
    return;
  }
  const selected = await vscode.window.showQuickPick(picks, { canPickMany: true, matchOnDetail: true, placeHolder: '选择要删除的坏链接（可多选）' });
  if (!selected || selected.length === 0) return;
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  // 删除时从后往前，避免偏移
  const sorted = selected.sort((a, b) => b.range.start.line - a.range.start.line);
  for (const it of sorted) {
    const line = doc.lineAt(it.range.start.line);
    const lineText = line.text;
    const before = lineText.slice(0, it.range.start.character);
    const after = lineText.slice(it.range.end.character);
    let startCol = it.range.start.character;
    const leftMatch = before.match(/(\s*)((?:\/\/)|#|--|;|%)\s*$/);
    if (leftMatch) startCol = before.length - leftMatch[0].length; else if (/^\s*$/.test(before)) startCol = 0;
    let endCol = it.range.end.character;
    if (/^\s*$/.test(after)) endCol = lineText.length;
    const delRange = new vscode.Range(new vscode.Position(it.range.start.line, startCol), new vscode.Position(it.range.end.line, endCol));
    await editor.edit(b => b.delete(delRange));
  }
  await doc.save();
}

function registerAutoRefresh(context: vscode.ExtensionContext, provider: LinksTreeProvider) {
  const debounced = (() => {
    let timer: NodeJS.Timeout | undefined;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => provider.refresh(), 500);
    };
  })();

  // 文档变更/保存/打开
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(debounced),
    vscode.workspace.onDidSaveTextDocument(debounced),
    vscode.workspace.onDidOpenTextDocument(debounced)
  );

  // 资产目录文件变化
  const ws = vscode.workspace.workspaceFolders?.[0];
  const assetsRoot = getAssetsDir();
  if (ws && assetsRoot) {
    let rel = assetsRoot;
    const root = ws.uri.fsPath;
    if (path.isAbsolute(rel)) rel = path.relative(root, rel);
    const pattern = new vscode.RelativePattern(ws, path.posix.join(rel.replace(/\\/g, '/'), '**/*'));
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(debounced);
    watcher.onDidCreate(debounced);
    watcher.onDidDelete(debounced);
    context.subscriptions.push(watcher);
  }
}

// Tokens 侧边视图已移除：映射的查看与删除改为走设置界面（Settings → DocuSnap: Comment Token Map）

