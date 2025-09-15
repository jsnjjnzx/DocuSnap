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

function getLineCommentToken(doc: vscode.TextDocument): string {
  const id = doc.languageId;
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
      return '//'; // cpp/c/csharp/java/js/ts/go/rust/kotlin/scala/swift 等
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

async function handleInsertImage() {
  const picks = await pickFiles({ Images: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] });
  if (!picks || picks.length === 0) return;
  const copied = await copyIntoAssets(picks, 'images');
  const editor = vscode.window.activeTextEditor;
  const prefix = editor ? getLineCommentToken(editor.document) : '//';
  const tags = copied.map((c) => `${prefix} @link@:${c.rel}`).join('\n');
  if (editor) insertAtCursor(editor, tags);
}

async function handleInsertDoc() {
  const picks = await pickFiles({ Documents: ['txt', 'md', 'pdf'] });
  if (!picks || picks.length === 0) return;
  const copied = await copyIntoAssets(picks, 'docs');
  const editor = vscode.window.activeTextEditor;
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

// ---------- Smart Paste ----------
function isWindows(): boolean {
  return process.platform === 'win32';
}

async function exportClipboardImageWindows(): Promise<string | undefined> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docusnap-'));
  const tmpPng = path.join(tmpDir, `clipboard-${Date.now()}.png`);
  const psScript = [
    '$ErrorActionPreference = "Stop";',
    'Add-Type -AssemblyName System.Windows.Forms;',
    'Add-Type -AssemblyName System.Drawing;',
    'if ([System.Windows.Forms.Clipboard]::ContainsImage()) {',
    '  $img = [System.Windows.Forms.Clipboard]::GetImage();',
    '  $bmp = New-Object System.Drawing.Bitmap $img;',
    `  $bmp.Save('${tmpPng.replace(/\\/g, '/')}', [System.Drawing.Imaging.ImageFormat]::Png);`,
    '  Write-Output "SAVED";',
    '} else {',
    '  Write-Output "NOIMAGE";',
    '}'
  ].join(' ');
  return new Promise<string | undefined>((resolve) => {
    exec(`powershell -NoProfile -STA -Command "${psScript}"`, (error, stdout) => {
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
  return new Promise<string[] | undefined>((resolve) => {
    exec(`powershell -NoProfile -STA -Command "${psScript}"`, (error, stdout) => {
      if (error) return resolve(undefined);
      const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
      if (lines[0] !== 'FILES') return resolve(undefined);
      resolve(lines.slice(1));
    });
  });
}

function asWorkspacePathMaybe(p: string): string | undefined {
  if (!p) return undefined;
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let abs = p;
  if (!path.isAbsolute(abs)) {
    if (!ws) return undefined;
    abs = path.join(ws, abs);
  }
  return abs;
}

function isImagePath(p: string): boolean {
  return /(\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp)$/i.test(p);
}

async function handleSmartPaste() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const prefix = getLineCommentToken(editor.document);

  // 收集候选：优先图片，其次文件列表，最后文本路径
  let foundType: 'image' | 'files' | 'paths' | undefined;
  let imgTmpPath: string | undefined;
  let fileUris: vscode.Uri[] | undefined;

  if (isWindows()) {
    // 仅检测是否有图片（不立即导出）
    const hasImg = await (async () => {
      const ps = [
        '$ErrorActionPreference = "SilentlyContinue";',
        'Add-Type -AssemblyName System.Windows.Forms;',
        'if ([System.Windows.Forms.Clipboard]::ContainsImage()) { Write-Output "HAS" } else { Write-Output "NO" }'
      ].join(' ');
      return await new Promise<boolean>((resolve) => {
        exec(`powershell -NoProfile -STA -Command "${ps}"`, (err, stdout) => {
          if (err) return resolve(false);
          resolve(/HAS/.test(String(stdout)));
        });
      });
    })();
    if (hasImg) {
      foundType = 'image';
    } else {
      const list = await readClipboardFileDropListWindows();
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
      const candidates = txt.split(/\r?\n|\s+/).filter(Boolean);
      const uris: vscode.Uri[] = [];
      for (let c of candidates) {
        if (c.startsWith('file://')) {
          try {
            c = vscode.Uri.parse(c).fsPath;
          } catch {}
        }
        const abs = asWorkspacePathMaybe(c);
        if (abs && fs.existsSync(abs)) uris.push(vscode.Uri.file(abs));
      }
      if (uris.length) {
        foundType = 'paths';
        fileUris = uris;
      }
    }
  }

  if (foundType) {
    const hint = foundType === 'image' ? '图片' : '文件';
    const choice = await vscode.window.showInformationMessage(
      `检测到剪贴板中有${hint}，是否插入 @link@ 链接？`,
      { modal: true },
      '插入链接',
      '重命名插入',
      '普通粘贴'
    );
    if (choice === '插入链接' || choice === '重命名插入') {
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
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    return;
  }

  // 未检测到可处理内容，回退到默认粘贴
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

  // 选择清理范围
  const scope = await vscode.window.showQuickPick([
    { label: '仅当前文件', value: 'file' },
    { label: '整个工作区', value: 'workspace' }
  ], { placeHolder: '选择清理范围' });
  if (!scope) return;
  const scopeVal = (scope as any).value as 'file' | 'workspace';

  // 读取配置的 globs
  const cfg = vscode.workspace.getConfiguration();
  const includeGlobs = cfg.get<string[]>('docuSnap.searchIncludeGlobs', ['**/*']);
  const excludeGlobs = cfg.get<string[]>('docuSnap.searchExcludeGlobs', ['**/node_modules/**']);

  // 1) 扫描所有 @link@（优化：通过 include/exclude globs 限定范围，再并行扫描内容）
  let texts: vscode.Uri[] = [];
  if (scopeVal === 'file') {
    if (vscode.window.activeTextEditor) texts = [vscode.window.activeTextEditor.document.uri];
  } else {
    const candidateSets = await Promise.all(includeGlobs.map(g => collectWorkspaceFiles(g, excludeGlobs)));
    const candidates = new Map<string, vscode.Uri>();
    for (const arr of candidateSets) for (const u of arr) candidates.set(u.fsPath, u);
    // 并入已打开的文本文档（未保存更改也能被扫描）
    for (const d of vscode.workspace.textDocuments) {
      if (d.uri.scheme === 'file') candidates.set(d.uri.fsPath, d.uri);
    }
    texts = Array.from(candidates.values());
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
        if (processed % 25 === 0) progress.report({ message: `已解析 ${processed}/${texts.length} 个文件…` });
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
  const orphanAssets: { label: string; detail: string; action: 'delete'; payload: { abs: string } }[] = [];
  for (const abs of allAssetFiles) {
    const relNorm = normalizeRel(path.relative(assetsRoot, abs).replace(/\\/g, '/'));
    if (!linkSet.has(relNorm)) {
      orphanAssets.push({ label: `删除孤立附件: ${path.relative(assetsRoot, abs).replace(/\\/g, '/')}`, detail: `附件路径: ${abs}`, action: 'delete', payload: { abs } });
    }
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

  // 5) 执行删除：
  // - 链接：直接从文档移除对应 range 的文本
  // - 附件：删除文件
  for (const item of picks) {
      if (item.action === 'unlink') {
        const { uri, range } = (item as any).payload as { uri: vscode.Uri; range: vscode.Range };
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });

        // 计算扩展删除范围：尽量把前导注释符号与空白一起删除
        const line = doc.lineAt(range.start.line);
        const lineText = line.text;
        const before = lineText.slice(0, range.start.character);
        const after = lineText.slice(range.end.character);

        // 向左扩展：匹配末尾的 [空白][注释符（//|#|--|;|%）][可选空白]
        let startCol = range.start.character;
        const leftMatch = before.match(/(\s*)((?:\/\/)|#|--|;|%)\s*$/);
        if (leftMatch) {
          startCol = before.length - leftMatch[0].length;
        } else if (/^\s*$/.test(before)) {
          // 如果前面全是空白，从行首开始删
          startCol = 0;
        }

        // 向右扩展：如果右侧只有空白，删到行尾
        let endCol = range.end.character;
        if (/^\s*$/.test(after)) {
          endCol = lineText.length;
        }

        const delRange = new vscode.Range(new vscode.Position(range.start.line, startCol), new vscode.Position(range.end.line, endCol));
        await editor.edit(b => b.delete(delRange));
        await doc.save();
    } else if (item.action === 'delete') {
      const { abs } = (item as any).payload as { abs: string };
      try { await fs.promises.unlink(abs); } catch {}
    }
  }

  vscode.window.showInformationMessage('清理完成。');
}

// ---------- Clipboard image/document insert command (Windows) ----------
async function handleInsertImageFromClipboard() {
  if (!isWindows()) {
    vscode.window.showWarningMessage('当前仅在 Windows 下支持从剪贴板插入图片/文档。');
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
  context.subscriptions.push(
    // 新命令 ID（显示为 DocuSnap/注释快贴）
    vscode.commands.registerCommand('docusnap.insertImage', handleInsertImage),
    vscode.commands.registerCommand('docusnap.insertDoc', handleInsertDoc),
    vscode.commands.registerCommand('docusnap.insertImageFromClipboard', handleInsertImageFromClipboard),
    vscode.commands.registerCommand('docusnap.smartPaste', handleSmartPaste),
    vscode.commands.registerCommand('docusnap.cleanInvalidLinks', handleCleanInvalidLinks),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, new AssetHoverProvider())
  );

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

  const cfg = vscode.workspace.getConfiguration();
  const includeGlobs = cfg.get<string[]>('docuSnap.searchIncludeGlobs', ['**/*']);
  const excludeGlobs = cfg.get<string[]>('docuSnap.searchExcludeGlobs', ['**/node_modules/**']);

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

