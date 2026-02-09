import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * 基础扩展示例测试
 */
suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('jsnjjnzx.docusnap-assets'));
    });

    test('Should activate extension', async () => {
        const ext = vscode.extensions.getExtension('jsnjjnzx.docusnap-assets');
        if (ext) {
            await ext.activate();
            assert.strictEqual(ext.isActive, true);
        }
    });

    test('All commands should be registered', () => {
        return vscode.commands.getCommands(true).then(commands => {
            const DOCUSNAP_COMMANDS = [
                'docusnap.insertImage',
                'docusnap.insertDoc',
                'docusnap.insertImageFromClipboard',
                'docusnap.smartPaste'
            ];
            DOCUSNAP_COMMANDS.forEach(cmd => {
                assert.ok(commands.includes(cmd), `Command ${cmd} not registered`);
            });
        });
    });
});
