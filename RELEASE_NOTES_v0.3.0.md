# DocuSnap v0.3.0 发布说明

## 🎉 主要更新

### ✨ WSL 完整支持
现在可以在 WSL 环境下完美使用 DocuSnap！

- ✅ 自动检测 WSL 环境
- ✅ 通过 `powershell.exe` 访问 Windows 剪贴板
- ✅ 自动转换路径格式（`C:\path` ↔ `/mnt/c/path`）
- ✅ 所有剪贴板功能正常工作：
  - 从剪贴板插入图片
  - 智能粘贴（Ctrl+V）
  - 文件列表读取

### 🧪 自动化测试框架
建立了完整的测试体系，确保代码质量：

**单元测试（18 个）**
- 路径处理函数
- WSL 环境检测
- Windows/WSL 路径转换
- 注释规则解析

**集成测试（10 个）**
- 扩展激活和命令注册
- 悬浮预览功能
- 链接扫描功能
- 多种引号格式支持

**开发工具**
- 快速测试脚本
- VSCode 调试配置
- GitHub Actions CI/CD
- 详细的测试文档

## 📊 测试结果

- ✅ 单元测试：18/18 通过（100%）
- ✅ 集成测试：8/10 通过（80%）
- ⚡ 运行时间：< 1 秒（单元测试）

## 🔧 技术改进

- 新增 `wslPathToWin()` 函数
- 新增 `canUseWindowsClipboard()` 检测
- 优化 PowerShell 调用逻辑
- 更新 TypeScript 配置

## 📚 新增文档

- `test/README.md` - 测试目录说明
- `测试指南.md` - 详细测试指南
- `测试实现总结.md` - 测试覆盖率总结

## 🚀 如何使用

### 在 WSL 中使用
1. 在 WSL 中打开 VSCode
2. 安装 DocuSnap 扩展
3. 所有功能自动适配 WSL 环境

### 运行测试
```bash
# 单元测试（快速）
npm run test:unit

# 集成测试
npm test

# 使用快速脚本
node test/runQuickTest.js unit
```

## 📦 安装方式

### 从 VSCode 市场安装
1. 打开 VSCode
2. 按 `Ctrl+Shift+X` 打开扩展面板
3. 搜索 "DocuSnap"
4. 点击安装

### 从 VSIX 文件安装
1. 下载 `docusnap-assets-0.3.0.vsix`
2. 在 VSCode 中按 `Ctrl+Shift+P`
3. 输入 "Install from VSIX"
4. 选择下载的文件

## 🔗 相关链接

- [GitHub 仓库](https://github.com/jsnjjnzx/DocuSnap)
- [问题反馈](https://github.com/jsnjjnzx/DocuSnap/issues)
- [完整更新日志](CHANGELOG.md)

## 🙏 致谢

感谢所有使用和反馈的用户！

---

**完整更新日志**: [CHANGELOG.md](https://github.com/jsnjjnzx/DocuSnap/blob/main/CHANGELOG.md)
