import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('链接扫描功能测试', () => {
  let testWorkspace: string;
  let assetsDir: string;

  suiteSetup(async () => {
    // 创建临时测试工作区
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-scan-'));
    assetsDir = path.join(testWorkspace, '.vscode', 'code-assets');
    fs.mkdirSync(path.join(assetsDir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(assetsDir, 'docs'), { recursive: true });

    // 创建测试资源文件
    fs.writeFileSync(path.join(assetsDir, 'images', 'valid.png'), 'fake png');
    fs.writeFileSync(path.join(assetsDir, 'docs', 'readme.md'), '# Test');

    // 创建包含各种链接的测试文件
    const testFiles = [
      {
        name: 'test1.js',
        content: `// @link@:images/valid.png\n// @link@:images/missing.png\nconsole.log('test');`
      },
      {
        name: 'test2.py',
        content: `# @link@:docs/readme.md\n# @link@:"images/valid.png"\nprint('test')`
      },
      {
        name: 'test3.ts',
        content: `// @link@:'images/valid.png'\n// 普通注释\nconst x = 1;`
      }
    ];

    for (const file of testFiles) {
      fs.writeFileSync(path.join(testWorkspace, file.name), file.content);
    }
  });

  suiteTeardown(() => {
    if (testWorkspace && fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  test('应该扫描工作区中的所有链接', async () => {
    // 打开工作区
    const workspaceUri = vscode.Uri.file(testWorkspace);
    
    // 查找所有包含 @link@ 的文件
    const files = await vscode.workspace.findFiles('**/*.{js,py,ts}', '**/node_modules/**');
    
    assert.ok(files.length >= 3, `应该找到至少 3 个测试文件，实际找到 ${files.length} 个`);
  });

  test('应该正确识别有效和无效的链接', async () => {
    const testFile = vscode.Uri.file(path.join(testWorkspace, 'test1.js'));
    const doc = await vscode.workspace.openTextDocument(testFile);
    const content = doc.getText();

    // 使用正则表达式匹配链接
    const linkRegex = /@link@\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`]+))/g;
    const matches = Array.from(content.matchAll(linkRegex));

    assert.strictEqual(matches.length, 2, '应该找到 2 个链接');

    // 检查第一个链接（有效）
    const link1 = matches[0][1] || matches[0][2] || matches[0][3] || matches[0][4];
    const link1Path = path.join(assetsDir, link1);
    assert.ok(fs.existsSync(link1Path), '第一个链接应该存在');

    // 检查第二个链接（无效）
    const link2 = matches[1][1] || matches[1][2] || matches[1][3] || matches[1][4];
    const link2Path = path.join(assetsDir, link2);
    assert.ok(!fs.existsSync(link2Path), '第二个链接不应该存在');
  });

  test('应该支持不同的引号格式', async () => {
    const testFile = vscode.Uri.file(path.join(testWorkspace, 'test2.py'));
    const doc = await vscode.workspace.openTextDocument(testFile);
    const content = doc.getText();

    const linkRegex = /@link@\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`]+))/g;
    const matches = Array.from(content.matchAll(linkRegex));

    assert.strictEqual(matches.length, 2, '应该找到 2 个链接');

    // 第一个链接：无引号
    const link1 = matches[0][1] || matches[0][2] || matches[0][3] || matches[0][4];
    assert.strictEqual(link1, 'docs/readme.md');

    // 第二个链接：双引号
    const link2 = matches[1][1] || matches[1][2] || matches[1][3] || matches[1][4];
    assert.strictEqual(link2, 'images/valid.png');
  });

  test('应该支持单引号格式', async () => {
    const testFile = vscode.Uri.file(path.join(testWorkspace, 'test3.ts'));
    const doc = await vscode.workspace.openTextDocument(testFile);
    const content = doc.getText();

    const linkRegex = /@link@\s*[:：]\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s"'`]+))/g;
    const matches = Array.from(content.matchAll(linkRegex));

    assert.strictEqual(matches.length, 1, '应该找到 1 个链接');

    const link = matches[0][1] || matches[0][2] || matches[0][3] || matches[0][4];
    assert.strictEqual(link, 'images/valid.png');
  });
});
