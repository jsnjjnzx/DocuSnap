import * as vscode from 'vscode';
import * as path from 'path';

export const ASSET_TAG_LINK = /@link@\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`]+))/;

// 规范化相对路径：去掉 ./ 或 / 前缀，\ -> /，Windows 下转小写
export function normalizeRel(p: string): string {
    let r = (p || '').trim();
    r = r.replace(/\\/g, '/');
    r = r.replace(/^\.\//, '');
    r = r.replace(/^\/+/, '');
    if (process.platform === 'win32') r = r.toLowerCase();
    return r;
}

export function isImageExt(p: string): boolean {
    return /(\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp)$/i.test(p);
}

// -------- Logging --------
let channel: vscode.OutputChannel | undefined;
export function getChannel(): vscode.OutputChannel {
    if (!channel) channel = vscode.window.createOutputChannel('DocuSnap');
    return channel;
}
function safeToStr(v: any): string {
    try { if (typeof v === 'string') return v; return JSON.stringify(v); } catch { return String(v); }
}
export function log(...args: any[]) {
    const ch = getChannel();
    const ts = new Date().toISOString();
    ch.appendLine(`[${ts}] ${args.map(a => safeToStr(a)).join(' ')}`);
}
// 读取配置控制详细日志输出（默认关闭）。开启后将打印候选样本、逐文件扫描、删除明细等调试信息。
export function isVerbose(): boolean {
    try {
        return !!vscode.workspace.getConfiguration().get<boolean>('docuSnap.verboseLog', false);
    } catch {
        return false;
    }
}
export function debugLog(...args: any[]) { if (isVerbose()) log(...args); }

export async function ensureDir(dir: string): Promise<void> {
    const fs = require('fs');
    await fs.promises.mkdir(dir, { recursive: true });
}

export function asWorkspacePathMaybe(p: string): string | undefined {
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

export function insertAtCursor(editor: vscode.TextEditor, text: string) {
    const { selections } = editor;
    editor.edit((builder: vscode.TextEditorEdit) => {
        for (const sel of selections) {
            builder.replace(sel, text);
        }
    });
}

export async function collectWorkspaceFiles(glob: string, excludes?: string[]): Promise<vscode.Uri[]> {
    const excludeGlob = excludes && excludes.length ? `{${excludes.join(',')}}` : '**/node_modules/**';
    const files = await vscode.workspace.findFiles(glob, excludeGlob);
    return files;
}
