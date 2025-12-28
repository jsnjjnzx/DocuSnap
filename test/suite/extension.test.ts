import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('DocuSnap 扩展测试套件', () => {
  vscode.window.showInformationMessage('开始运行所有测试。');

  test('扩展应该被激活', async () => {
    const ext = vscode.extensions.getExtension('jsnjjnzx.docusnap-assets');
    assert.ok(ext, '扩展未找到');
    
    if (!ext.isActive) {
      await ext.activate();
    }
    
    assert.ok(ext.isActive, '扩展未激活');
  });

  test('所有命令应该被注册', async () => {
    const commands = await vscode.commands.getCommands(true);
    
    const expectedCommands = [
      'docusnap.insertImage',
      'docusnap.insertDoc',
      'docusnap.insertImageFromClipboard',
      'docusnap.smartPaste',
      'docusnap.cleanInvalidLinks',
      'docusnap.diagnostics',
      'docusnap.showLog',
      'docusnap.links.refresh',
      'docusnap.openLinkLocation',
      'docusnap.links.cleanFile',
      'docusnap.links.cleanSingle',
      'docusnap.links.toggleShowMissing',
      'docusnap.links.search',
      'docusnap.preview.clear',
      'docusnap.pinPreview',
      'docusnap.deleteCommentTokens'
    ];

    for (const cmd of expectedCommands) {
      assert.ok(commands.includes(cmd), `命令 ${cmd} 未注册`);
    }
  });

  test('配置项应该存在', () => {
    const config = vscode.workspace.getConfiguration('docuSnap');
    
    assert.ok(config.has('assetsDir'), '缺少 assetsDir 配置');
    assert.ok(config.has('overridePaste'), '缺少 overridePaste 配置');
    assert.ok(config.has('verboseLog'), '缺少 verboseLog 配置');
    assert.ok(config.has('commentTokenRules'), '缺少 commentTokenRules 配置');
  });

  test('默认配置值应该正确', () => {
    const config = vscode.workspace.getConfiguration('docuSnap');
    
    assert.strictEqual(config.get('assetsDir'), '.vscode/code-assets');
    assert.strictEqual(config.get('overridePaste'), false);
    assert.strictEqual(config.get('verboseLog'), false);
    
    const rules = config.get<string[]>('commentTokenRules');
    assert.ok(Array.isArray(rules), 'commentTokenRules 应该是数组');
    assert.ok(rules!.length > 0, 'commentTokenRules 不应为空');
  });
});
