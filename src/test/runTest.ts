import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/**
 * 启动 VS Code 实例并运行测试脚本
 */
async function main() {
    try {
        // 扩展的主目录
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // 测试运行器的路径
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // 下载 VS Code 并运行集成测试
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();
