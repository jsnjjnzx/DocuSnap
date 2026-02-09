# DocuSnap 自动化测试指南

本项目已配置基于 `Mocha` 和 `@vscode/test-electron` 的自动化集成测试框架。

## 环境要求

- Node.js
- VS Code (测试运行时会自动下载一个临时的实例)

## 如何运行测试

在项目根目录下运行以下命令：

```bash
npm test
```

该命令会执行以下操作：
1. `npm run compile`: 编译 TypeScript 代码（包括测试代码）。
2. `node ./out/test/runTest.js`: 启动测试引导脚本，下载并启动一个干净的 VS Code 实例，在其中运行测试。

## 测试目录结构

- `src/test/runTest.ts`: 测试启动入口，配置 VS Code 运行参数。
- `src/test/suite/index.ts`: 测试运行器，负责加载所有的 `.test.js` 文件。
- `src/test/suite/extension.test.ts`: 具体的测试用例文件。

## 编写新测试

1. 在 `src/test/suite/` 下创建以 `.test.ts` 结尾的文件。
2. 使用 `suite` 和 `test` 定义测试：

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('My Feature Test Suite', () => {
    test('Something should work', () => {
        assert.strictEqual(1, 1);
    });
});
```

## 常见问题

### Windows 下的 "bad option" 错误
如果在执行 `npm test` 时遇到 `Code.exe: bad option: --extensionTestsPath...` 错误，这通常是由于环境路径或 Shell 配置导致的。
- 确保您的路径中没有特殊的字符。
- 尝试在不同的终端（如 CMD 或 PowerShell 管理员权限）中运行。
- 如果持续失败，可以尝试手动启动 VS Code 并加载测试插件。
