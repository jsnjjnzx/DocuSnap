import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ensureDir } from './utils';
import { getEffectiveCommentMap, getLineCommentToken } from './config';
import { insertAtCursor, ASSET_TAG_LINK } from './utils';

export function getAssetsDir(): string | undefined {
    const cfg = vscode.workspace.getConfiguration();
    const dir = cfg.get<string>('docuSnap.assetsDir', '.vscode/code-assets');
    // 如果是绝对路径，直接使用；否则以工作区根为基准
    if (path.isAbsolute(dir)) return dir;
    const ws = vscode.workspace.workspaceFolders?.[0];
    return ws ? path.join(ws.uri.fsPath, dir) : undefined;
}

export async function pickFiles(filters?: { [name: string]: string[] }): Promise<vscode.Uri[] | undefined> {
    return vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: true, filters });
}

// 支持按文件自定义重命名：renamer 返回基础文件名（不含扩展名）；返回 undefined/空字符串时沿用原名
export async function copyIntoAssets(
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
            } catch { }
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

export function isRelInAssets(rel: string, assetsRoot: string): boolean {
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

function hasRuleForDocument(doc: vscode.TextDocument): boolean {
    try {
        const map = getEffectiveCommentMap();
        const ext = path.extname(doc.fileName).toLowerCase().replace(/^\./, '');
        return !!(ext && map && map[ext]);
    } catch {
        return false;
    }
}

export async function maybePromptConfigureRules(doc?: vscode.TextDocument): Promise<boolean> {
    if (!doc) return true;
    if (hasRuleForDocument(doc)) return true;
    const choice = await vscode.window.showWarningMessage(
        '未找到当前文件扩展名的注释规则。请在设置中配置 docuSnap.commentTokenRules 后再尝试插入。',
        { modal: true },
        '打开设置',
        '取消'
    );
    if (choice === '打开设置') {
        try { await vscode.commands.executeCommand('workbench.action.openSettings', 'docuSnap.commentTokenRules'); } catch { }
    }
    return false; // 阻断式：缺少规则时不继续插入
}

export async function handleInsertImage() {
    const picks = await pickFiles({ Images: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] });
    if (!picks || picks.length === 0) return;
    const copied = await copyIntoAssets(picks, 'images');
    const editor = vscode.window.activeTextEditor;
    if (editor) { const ok = await maybePromptConfigureRules(editor.document); if (!ok) return; }
    const prefix = editor ? getLineCommentToken(editor.document) : '//';
    const tags = copied.map((c) => `${prefix} @link@:${c.rel}`).join('\n');
    if (editor) insertAtCursor(editor, tags);
}

export async function handleInsertDoc() {
    const picks = await pickFiles({ Documents: ['txt', 'md', 'pdf'] });
    if (!picks || picks.length === 0) return;
    const copied = await copyIntoAssets(picks, 'docs');
    const editor = vscode.window.activeTextEditor;
    if (editor) { const ok = await maybePromptConfigureRules(editor.document); if (!ok) return; }
    const prefix = editor ? getLineCommentToken(editor.document) : '//';
    const tags = copied.map((c) => `${prefix} @link@:${c.rel}`).join('\n');
    if (editor) insertAtCursor(editor, tags);
}
