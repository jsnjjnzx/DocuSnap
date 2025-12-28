# DocuSnap v0.3.4 发布说明

## 🔧 关键修复

### 编译配置问题修复

**问题描述**：
- v0.3.1-0.3.3 版本存在严重的编译配置错误
- TypeScript 编译输出到 `out/src/extension.js`，但 VSCode 加载的是 `out/extension.js`
- 导致扩展实际运行的是旧版本代码
- 所有新增的调试日志和功能改进都不会生效

**修复内容**：
- 修正 `tsconfig.json` 中的 `rootDir` 配置：`"."` → `"src"`
- 调整 `include` 配置，排除测试文件避免混淆
- 确保编译输出路径与 `package.json` 的 `main` 字段匹配
- 删除旧的 `out/src/` 目录，避免加载错误代码

**影响范围**：
- ✅ 所有调试日志现在能正确输出
- ✅ WSL 环境下的剪贴板检测功能正常工作
- ✅ 智能粘贴功能的所有改进都能生效

## 📝 使用说明

### 升级步骤

1. **卸载旧版本**（可选但推荐）
   ```bash
   # 在 VSCode 扩展面板中卸载 DocuSnap
   ```

2. **安装 v0.3.4**
   ```bash
   # 方式 1：从 VSIX 文件安装
   code --install-extension docusnap-assets-0.3.4.vsix
   
   # 方式 2：从扩展市场安装（发布后）
   # 在 VSCode 扩展面板搜索 "DocuSnap" 并更新
   ```

3. **重新加载 VSCode**
   - 按 `Ctrl+Shift+P`
   - 输入 "Reload Window"
   - 回车

### 验证安装

1. **检查版本**
   - 打开扩展面板
   - 找到 DocuSnap
   - 确认版本号为 `0.3.4`

2. **启用详细日志**
   ```json
   {
     "docuSnap.verboseLog": true
   }
   ```

3. **测试功能**
   - 复制一张图片到剪贴板
   - 在代码文件中按 `Ctrl+V`
   - 应该看到弹窗提示："DocuSnap: handleSmartPaste 被调用了！"
   - 查看输出面板（`Ctrl+Shift+U` → 选择 "DocuSnap"）
   - 应该看到详细的日志输出

### WSL 用户特别说明

如果你在 WSL 环境下使用：

1. **确认 WSL 检测**
   - 查看日志中的 `canUseWindowsClipboard` 输出
   - 应该显示：`{ platform: 'linux', isWSL: true, result: true }`

2. **确认 PowerShell 命令**
   - 查看日志中的 `getPowerShellCommand` 输出
   - 应该显示：`using powershell.exe for WSL`

3. **测试剪贴板功能**
   - 在 Windows 中复制图片
   - 在 WSL 的 VSCode 中粘贴
   - 应该弹出选择对话框

## 🐛 已知问题

无新增已知问题。

## 📚 相关文档

- [完整更新日志](CHANGELOG.md)
- [WSL 测试指南](WSL测试指南.md)
- [测试指南](测试指南.md)

## 🙏 致谢

感谢所有测试用户的反馈和耐心！

---

**发布日期**：2025-12-28  
**版本号**：0.3.4  
**下载**：[docusnap-assets-0.3.4.vsix](docusnap-assets-0.3.4.vsix)
