import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { debugLog, log, isVerbose, asWorkspacePathMaybe, isImageExt, insertAtCursor } from './utils';
import { copyIntoAssets, getAssetsDir, maybePromptConfigureRules } from './assets';
import { getLineCommentToken } from './config';

export function isWindows(): boolean {
    return process.platform === 'win32';
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
    } catch { }
    return false;
}

// 检查是否可以使用 Windows 剪贴板功能（原生 Windows 或 WSL）
function canUseWindowsClipboard(): boolean {
    const result = process.platform === 'win32' || isWSL();
    debugLog('canUseWindowsClipboard', { platform: process.platform, isWSL: isWSL(), result });
    return result;
}

// 获取 PowerShell 命令（WSL 中需要使用 powershell.exe）
function getPowerShellCommand(): string {
    if (process.platform === 'win32') {
        return 'powershell';
    }
    if (isWSL()) {
        // 在 WSL 中使用 powershell.exe 调用 Windows PowerShell
        debugLog('getPowerShellCommand: using powershell.exe for WSL');
        return 'powershell.exe';
    }
    return 'powershell';
}

async function wslToWindowsPath(wslPath: string): Promise<string> {
    return new Promise((resolve) => {
        exec(`wslpath -w "${wslPath}"`, (err, stdout) => {
            if (err) return resolve(wslPath);
            resolve(stdout.trim());
        });
    });
}

async function windowsToWslPath(winPath: string): Promise<string> {
    return new Promise((resolve) => {
        // Escape backslashes for the shell command
        const escaped = winPath.replace(/\\/g, '\\\\');
        exec(`wslpath -u "${escaped}"`, (err, stdout) => {
            if (err) return resolve(winPath);
            resolve(stdout.trim());
        });
    });
}

function normalizeForStat(p: string): string {
    if (!p) return p;
    if (isWSL() && /^([a-zA-Z]):\\/.test(p)) {
        return winPathToWSL(p);
    }
    return p;
}

function winPathToWSL(p: string): string {
    // d:\dir\file -> /mnt/d/dir/file
    const m = /^([a-zA-Z]):\\(.*)$/.exec(p);
    if (!m) return p;
    const drive = m[1].toLowerCase();
    const rest = m[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
}

export async function exportClipboardImageWindows(): Promise<string | undefined> {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docusnap-'));
    const tmpPng = path.join(tmpDir, `clipboard-${Date.now()}.png`);

    debugLog('exportClipboardImage: tmpPng', { tmpPng, isWSL: isWSL() });

    let savePath = tmpPng;
    if (isWSL()) {
        savePath = await wslToWindowsPath(tmpPng);
        debugLog('exportClipboardImage: converted path', { wslPath: tmpPng, winPath: savePath });
    }
    // 统一使用正斜杠，避免转义问题
    savePath = savePath.replace(/\\/g, '/');

    const psScript = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
  $img = [System.Windows.Forms.Clipboard]::GetImage()
  $bmp = New-Object System.Drawing.Bitmap $img
  $bmp.Save('${savePath}', [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "SAVED"
} else {
  Write-Output "NOIMAGE"
}
`.trim();

    // 使用 Base64 编码避免转义问题
    const psScriptBase64 = Buffer.from(psScript, 'utf16le').toString('base64');
    const cmd = getPowerShellCommand();
    debugLog('exportClipboardImage: executing PowerShell', { psCmd: cmd, savePath });

    return new Promise<string | undefined>((resolve) => {
        exec(`${cmd} -NoProfile -STA -EncodedCommand ${psScriptBase64}`, (error, stdout, stderr) => {
            if (error) {
                debugLog('exportClipboardImage: error', { error: error.message, stderr });
                return resolve(undefined);
            }
            const saved = /SAVED/.test(stdout);
            debugLog('exportClipboardImage: result', { stdout: stdout.trim(), saved, tmpPng });

            // 验证文件是否真的存在
            if (saved) {
                try {
                    const exists = fs.existsSync(tmpPng);
                    debugLog('exportClipboardImage: file exists check', { tmpPng, exists });
                    if (exists) {
                        return resolve(tmpPng);
                    }
                } catch (e) {
                    debugLog('exportClipboardImage: file check error', { error: (e as Error).message });
                }
            }
            resolve(undefined);
        });
    });
}

export async function readClipboardFileDropListWindows(): Promise<string[] | undefined> {
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
        const cmd = getPowerShellCommand();
        exec(`${cmd} -NoProfile -STA -Command "${psScript}"`, async (error, stdout) => {
            if (error) return resolve(undefined);
            const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
            if (lines[0] !== 'FILES') return resolve(undefined);

            let files = lines.slice(1);
            if (isWSL()) {
                files = await Promise.all(files.map(f => windowsToWslPath(f)));
            }
            resolve(files);
        });
    });
}

export async function handleSmartPaste() {

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        console.log('[DocuSnap] No active editor');
        vscode.window.showWarningMessage('DocuSnap: 没有活动编辑器');
        return;
    }
    const prefix = getLineCommentToken(editor.document);

    // 无条件输出，用于调试
    console.log('[DocuSnap] SmartPaste start', {
        platform: process.platform,
        isWSL: isWSL(),
        verboseLog: isVerbose()
    });
    log('SmartPaste: start (unconditional)', {
        platform: process.platform,
        isWSL: isWSL(),
        verboseLog: isVerbose()
    });

    debugLog('SmartPaste: start', { platform: process.platform, isWSL: isWSL() });

    // 统一在函数顶部声明候选，以便各分支可提前命中
    let foundType: 'image' | 'files' | 'paths' | undefined;
    let imgTmpPath: string | undefined;
    let fileUris: vscode.Uri[] | undefined;

    // 0) 先快速读取文本剪贴板：如果是普通文本，直接走系统粘贴，避免昂贵的 PowerShell 探测
    try {
        const txt = await vscode.env.clipboard.readText();
        debugLog('SmartPaste: clipboard text', { hasText: !!txt, length: txt?.length || 0 });
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
                    try { p = vscode.Uri.parse(p).fsPath; } catch { }
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
                } catch { }
            }

            const fileish = looksLikeFilePath(trimmed);
            debugLog('SmartPaste fast-check', { text: trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed, fileish, earlyFound: !!foundType });
            // 若文本不像具体文件路径/URI，且也未通过“存在性”快速命中，则直接快速粘贴
            // 注意：在 WSL 环境下，readText 可能读到旧的剪贴板内容，因此即使读到文本，也应继续检查 Windows 剪贴板是否有图片
            if (!fileish && !foundType && !isWSL()) {
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                return;
            }
        }
    } catch { /* ignore and continue */ }

    // 收集候选：优先图片，其次文件列表，最后文本路径
    // 注意：若上面的“存在性快速命中”已设置 foundType，将直接跳过后续昂贵探测
    if (!foundType) {

        if (canUseWindowsClipboard()) {
            debugLog('SmartPaste: entering Windows clipboard check', { canUse: true, isWSL: isWSL() });
            // 仅检测是否有图片（不立即导出）
            const hasImg = await (async () => {
                const ps = [
                    '$ErrorActionPreference = "SilentlyContinue";',
                    'Add-Type -AssemblyName System.Windows.Forms;',
                    'if ([System.Windows.Forms.Clipboard]::ContainsImage()) { Write-Output "HAS" } else { Write-Output "NO" }'
                ].join(' ');
                const probe = new Promise<boolean>((resolve) => {
                    const cmd = getPowerShellCommand();
                    debugLog('SmartPaste: checking clipboard image', { psCmd: cmd });
                    exec(`${cmd} -NoProfile -STA -Command "${ps}"`, (err, stdout) => {
                        if (err) {
                            debugLog('SmartPaste: clipboard image check error', { error: err.message });
                            return resolve(false);
                        }
                        const hasImage = /HAS/.test(String(stdout));
                        debugLog('SmartPaste: clipboard image check result', { stdout: String(stdout).trim(), hasImage });
                        resolve(hasImage);
                    });
                });
                // 超时保护：WSL 环境需要更长时间（约 500ms），原生 Windows 也需要足够时间
                const timeoutMs = isWSL() ? 800 : 500;
                debugLog('SmartPaste: clipboard check timeout', { timeoutMs, isWSL: isWSL() });
                const timeout = new Promise<boolean>(res => setTimeout(() => {
                    debugLog('SmartPaste: clipboard check timeout reached');
                    res(false);
                }, timeoutMs));
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
                        } catch { }
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
                        } catch { }
                    }
                    const abs = asWorkspacePathMaybe(c);
                    if (abs) {
                        const statPath = normalizeForStat(abs);
                        try {
                            const st = fs.statSync(statPath);
                            const isFile = st.isFile();
                            const allowed = isFile && (isImageExt(abs) || /(\.md|\.txt|\.pdf)$/i.test(abs));
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
                    const imgs = uris.filter((u) => isImageExt(u.fsPath));
                    const others = uris.filter((u) => !isImageExt(u.fsPath));
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
                    } catch { }
                    try {
                        await fs.promises.rm(path.dirname(imgTmpPath), { recursive: true, force: true });
                    } catch { }
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

export async function handleInsertImageFromClipboard() {
    if (!isWindows() && !isWSL()) {
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
            } catch { }
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
            const imgs = uris.filter(u => isImageExt(u.fsPath));
            const others = uris.filter(u => !isImageExt(u.fsPath));
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
            try { await fs.promises.unlink(tmp); } catch { }
            try { await fs.promises.rm(path.dirname(tmp), { recursive: true, force: true }); } catch { }
        }
    }
}
