import * as vscode from 'vscode';
import * as path from 'path';

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

export function getEffectiveCommentMap(): Record<string, string> {
    // Rules-only: compile rules to ext -> token map
    try {
        const cfg = vscode.workspace.getConfiguration();
        const rulesArr = cfg.get<string[]>('docuSnap.commentTokenRules', []);
        return parseCommentTokenRules(rulesArr);
    } catch {
        return {};
    }
}

export function getLineCommentToken(doc: vscode.TextDocument): string {
    const id = doc.languageId;
    // 优先读取配置的白名单映射（按扩展名匹配）
    try {
        const map = getEffectiveCommentMap();
        if (map) {
            const ext = path.extname(doc.fileName).toLowerCase().replace(/^\./, '');
            if (ext && map[ext]) return map[ext];
        }
    } catch { }
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

// 汇总默认排除 + VS Code 的 files.exclude 与 search.exclude
export function getWorkspaceExcludes(): string[] {
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

export async function handleDeleteCommentTokens() {
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
}
