import * as path from 'path';
import Mocha = require('mocha');
import { glob } from 'glob';

/**
 * 运行测试套件的主函数
 */
export async function run(): Promise<void> {
    // 创建 mocha 实例
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = path.resolve(__dirname, '..');

    // 查找所有的测试文件
    const files = await glob('**/*.test.js', { cwd: testsRoot });

    // 将文件添加到 mocha
    files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

    try {
        return new Promise((c, e) => {
            // 运行 mocha 测试
            mocha.run((failures: number) => {
                if (failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            });
        });
    } catch (err) {
        console.error(err);
        throw err;
    }
}
