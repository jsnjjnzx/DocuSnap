import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getEffectiveCommentMap, getWorkspaceExcludes } from '../config';
import { getAssetsDir, isRelInAssets } from '../assets';
import { normalizeRel, log, debugLog, isVerbose, ASSET_TAG_LINK, collectWorkspaceFiles } from '../utils';

// Used in handleCleanInvalidLinks
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

/**
 * 阶段四性能优化：行号索引类，避免重复拆分字符串
 */
class LineIndex {
    private lineOffsets: number[] = [];
    constructor(content: string) {
        this.lineOffsets = [0];
        for (let i = 0; i < content.length; i++) {
            if (content[i] === '\n') {
                this.lineOffsets.push(i + 1);
            }
        }
    }
    public getLineNumber(offset: number): number {
        let low = 0, high = this.lineOffsets.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (this.lineOffsets[mid] <= offset) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return high;
    }
}


function findLinkRangeInDoc(doc: vscode.TextDocument, relNorm: string, nearLine?: number): vscode.Range | undefined {
    // Use regex from local or utils (utils is better but we use local regex in original code)
    // Let's use the one from utils but make sure it has 'g' flag if we loop.
    // Actually ASSET_TAG_LINK from utils is not global.
    // We need loop.
    const re = new RegExp(ASSET_TAG_LINK.source, 'g');
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

// ---------------- Links Tree View ----------------
type TreeNode = FileNode | LinkNode;

export class FileNode extends vscode.TreeItem {
    constructor(public readonly uri: vscode.Uri, public readonly count: number) {
        super(vscode.workspace.asRelativePath(uri), vscode.TreeItemCollapsibleState.Collapsed);
        this.resourceUri = uri;
        this.iconPath = new vscode.ThemeIcon('file');
        this.description = `${count}`;
        this.contextValue = 'docusnap.file';
    }
}

export class LinkNode extends vscode.TreeItem {
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

export class LinksTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private cache: Map<string, LinkNode[]> = new Map();
    private showOnlyMissing = false;
    private searchQuery: string | undefined;

    refresh(): void {
        this.cache.clear();
        this._onDidChangeTreeData.fire();
    }

    /**
     * 阶段四性能优化：增量更新单个文件
     */
    async refreshFile(uri: vscode.Uri): Promise<void> {
        // 如果从未扫描过，由于 getChildren 会调用 ensureScanned，直接 refresh 即可
        if (this.cache.size === 0) {
            this.refresh();
            return;
        }
        const updatedLinks = await scanLinksInFile(uri);
        if (updatedLinks && updatedLinks.length > 0) {
            this.cache.set(uri.fsPath, updatedLinks);
        } else {
            this.cache.delete(uri.fsPath);
        }
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

    const re = new RegExp(ASSET_TAG_LINK.source, 'g');
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
                const links = await scanLinksInFile(uri);
                if (links && links.length > 0) {
                    out.set(uri.fsPath, links);
                }
            } catch { }
        }
    }));

    return out;
}

/**
 * 阶段四性能优化：提取单文件扫描逻辑，支持增量更新和行号索引
 */
async function scanLinksInFile(uri: vscode.Uri): Promise<LinkNode[]> {
    const assetsRoot = getAssetsDir();
    const assetsRootDir = assetsRoot || '';
    if (!assetsRootDir) return [];

    try {
        const content = await getTextForUri(uri);
        const re = new RegExp(ASSET_TAG_LINK.source, 'g');
        const lineIndex = new LineIndex(content);
        const results: LinkNode[] = [];

        let m: RegExpExecArray | null;
        re.lastIndex = 0;

        async function fileExistsAbs(abs: string): Promise<boolean> {
            try { const st = await fs.promises.stat(abs); return st.isFile() || st.isDirectory(); } catch { return false; }
        }

        while ((m = re.exec(content))) {
            const relRaw = (m[1] || m[2] || m[3] || m[4]);
            const relNorm = normalizeRel(relRaw);
            if (!isRelInAssets(relNorm, assetsRootDir)) continue;

            const line = lineIndex.getLineNumber(m.index);
            const abs = path.join(assetsRootDir, relNorm);
            const exists = await fileExistsAbs(abs);
            results.push(new LinkNode(uri, relRaw, line, exists));
        }
        return results;
    } catch {
        return [];
    }
}


// 针对单个文件执行清理坏链接
export async function cleanInvalidLinksForFile(uri: vscode.Uri) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const content = doc.getText();
    const assetsRoot = getAssetsDir();
    if (!assetsRoot) {
        vscode.window.showWarningMessage('未配置资产目录。');
        return;
    }
    const re = new RegExp(ASSET_TAG_LINK.source, 'g');
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
    vscode.window.showInformationMessage(`已完成文件清理：共删除 ${selected.length} 条坏链接。`);
}

export async function handleCleanSingleLink(node: LinkNode) {
    if (!node) return;
    try {
        const doc = await vscode.workspace.openTextDocument(node.parent);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const relNorm = normalizeRel(node.relRaw);

        // Find range using local helper
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
        vscode.window.showInformationMessage(`已删除坏链接：${node.relRaw}`);
    } catch (e) {
        vscode.window.showErrorMessage('清理链接失败：' + (e as Error).message);
    }
}

export async function handleCleanInvalidLinks() {
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
                    const re = new RegExp(ASSET_TAG_LINK.source, 'g');
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
                } catch { }
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
        } catch { }
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
            const byFile = new Map<string, Array<{ uri: vscode.Uri; range: vscode.Range; relRaw: string }>>();
            for (const it of unlinkItems) {
                const { uri, range, relRaw } = it.payload as any;
                const key = uri.fsPath;
                if (!byFile.has(key)) byFile.set(key, []);
                byFile.get(key)!.push({ uri, range, relRaw });
            }

            const cleanedLinksDetail: string[] = [];
            for (const [fsPath, arr] of byFile.entries()) {
                if (token.isCancellationRequested) break;
                try {
                    const uri = vscode.Uri.file(fsPath);
                    const doc = await vscode.workspace.openTextDocument(uri);
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
                    const we = new vscode.WorkspaceEdit();
                    for (const r of expanded) we.delete(uri, r);
                    await vscode.workspace.applyEdit(we);
                    await doc.save();
                    deletedCount += arr.length;
                    const relFile = vscode.workspace.asRelativePath(uri);
                    cleanedLinksDetail.push(`${relFile}: 已清理 ${arr.length} 条坏链接 (${arr.map(a => a.relRaw).join(', ')})`);
                } catch { }
                report();
            }

            // 5.2 附件删除
            const cleanedAssetsDetail: string[] = [];
            for (const it of fileDelItems) {
                if (token.isCancellationRequested) break;
                try {
                    await fs.promises.unlink(it.payload.abs);
                    deletedCount += 1;
                    cleanedAssetsDetail.push(`删除附件: ${path.relative(assetsRootDir, it.payload.abs).replace(/\\/g, '/')}`);
                } catch { }
                report();
            }

            if (deletedCount > 0) {
                const summary = [];
                if (cleanedLinksDetail.length > 0) summary.push(`${byFile.size} 个文件中的 ${totalUnlink} 条链接`);
                if (cleanedAssetsDetail.length > 0) summary.push(`${totalFileDel} 个孤立附件`);

                const fullMsg = `清理完成。已删除 ${summary.join('，')}。`;
                vscode.window.showInformationMessage(fullMsg, '查看明细').then(btn => {
                    if (btn === '查看明细') {
                        const output = vscode.window.createOutputChannel('DocuSnap Cleanup Details');
                        output.appendLine('--- DocuSnap 清理明细 ---');
                        if (cleanedLinksDetail.length > 0) {
                            output.appendLine('\n[坏链接清理]');
                            cleanedLinksDetail.forEach(d => output.appendLine(d));
                        }
                        if (cleanedAssetsDetail.length > 0) {
                            output.appendLine('\n[孤立附件清理]');
                            cleanedAssetsDetail.forEach(d => output.appendLine(d));
                        }
                        output.show();
                    }
                });
            } else {
                vscode.window.showInformationMessage('未执行任何清理操作。');
            }
        });
    } finally {
        sb.hide();
        sb.dispose();
    }
    log('CleanInvalid: end', { deletedCount, totalAll });
}
