import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('悬浮预览功能测试', () => {
  let testWorkspace: string;
  let assetsDir: string;
  let testFile: vscode.Uri;

  suiteSetup(async () => {
    // 创建临时测试工作区
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-test-'));
    assetsDir = path.join(testWorkspace, '.vscode', 'code-assets', 'images');
    fs.mkdirSync(assetsDir, { recursive: true });

    // 创建测试图片
    const testImagePath = path.join(assetsDir, 'test.png');
    // 创建一个简单的 1x1 PNG 图片（最小有效 PNG）
    const pngData = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82
    ]);
    fs.writeFileSync(testImagePath, pngData);

    // 创建测试代码文件
    const testFilePath = path.join(testWorkspace, 'test.js');
    const content = `// 这是测试文件\n// @link@:images/test.png\nconsole.log('test');\n`;
    fs.writeFileSync(testFilePath, content);
    
    testFile = vscode.Uri.file(testFilePath);
  });

  suiteTeardown(() => {
    // 清理临时文件
    if (testWorkspace && fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  test('应该为 @link@ 标记提供悬浮提示', async () => {
    const doc = await vscode.workspace.openTextDocument(testFile);
    const editor = await vscode.window.showTextDocument(doc);

    // 在包含 @link@ 的行上请求悬浮提示
    const position = new vscode.Position(1, 5); // 第二行，@link@ 位置
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      position
    );

    assert.ok(hovers && hovers.length > 0, '应该返回悬浮提示');
  });

  test('悬浮提示应该包含图片预览', async () => {
    const doc = await vscode.workspace.openTextDocument(testFile);
    const position = new vscode.Position(1, 10);
    
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      position
    );

    if (hovers && hovers.length > 0) {
      const hover = hovers[0];
      const content = hover.contents[0];
      
      if (content instanceof vscode.MarkdownString) {
        const markdown = content.value;
        assert.ok(
          markdown.includes('![asset]') || markdown.includes('固定预览'),
          '悬浮提示应该包含图片或固定预览按钮'
        );
      }
    }
  });
});
