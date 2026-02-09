const Module = require('module');
const path = require('path');
const assert = require('assert');

// 1. 强制拦截 'vscode' 模块的加载
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    get: (key, defaultValue) => {
                        if (key === 'docuSnap.commentTokenRules') {
                            return global.mockRules || [];
                        }
                        return defaultValue;
                    }
                }),
                onDidChangeConfiguration: (callback) => {
                    global.onConfigChange = callback;
                    return { dispose: () => { } };
                }
            },
            ConfigurationTarget: {
                Global: 1,
                Workspace: 2,
                WorkspaceFolder: 3
            }
        };
    }
    return originalLoad.apply(this, arguments);
};

// 2. 加载目标模块
const configPath = path.resolve(__dirname, '../out/config.js');
const config = require(configPath);

// 测试开始
console.log('Running Phase 1 cache verification with Module intercept...');

// 1. 初始化
global.mockRules = ['{ts}-{//}'];
const map1 = config.getEffectiveCommentMap();
assert.deepStrictEqual(map1, { ts: '//' });
console.log('[OK] Initial fetch');

// 2. 验证缓存是否返回同一个对象
const map2 = config.getEffectiveCommentMap();
assert.strictEqual(map1, map2, 'Cache should return the same object reference');
console.log('[OK] Cache hit (same reference)');

// 3. 模拟配置变更并验证失效
global.mockRules = ['{ts}-{//}', '{py}-{#}'];
global.onConfigChange({
    affectsConfiguration: (key) => key === 'docuSnap.commentTokenRules'
});

const map3 = config.getEffectiveCommentMap();
assert.notStrictEqual(map1, map3, 'Cache should be invalidated after config change');
assert.deepStrictEqual(map3, { ts: '//', py: '#' });
console.log('[OK] Cache invalidation');

console.log('========================================');
console.log('Phase 1 Cache Verification Passed!');
console.log('========================================');
