import * as path from 'path';
import Mocha from 'mocha';
import * as glob from 'glob';

export function run(): Promise<void> {
  // 创建 Mocha 测试运行器
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000
  });

  const testsRoot = path.resolve(__dirname, '..');

  return new Promise((resolve, reject) => {
    try {
      // 只查找 suite 目录下的测试文件，排除 unit 目录
      const files = glob.sync('suite/**/*.test.js', { cwd: testsRoot });
      
      // 添加测试文件到测试套件
      files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

      // 运行 Mocha 测试
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} 个测试失败`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
