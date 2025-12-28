# WSL 环境测试指南

## ⚠️ 重要提示：编译配置问题（v0.3.1-0.3.3）

**如果你使用的是 v0.3.1、v0.3.2 或 v0.3.3 版本，请升级到 v0.3.4！**

这些版本存在编译配置错误，导致：
- VSCode 加载的是旧版本代码（`out/extension.js`）
- 实际编译输出到了错误位置（`out/src/extension.js`）
- 所有调试日志和功能改进都不会生效
- 看起来像是功能失效，实际上是加载了旧代码

**v0.3.4 已修复此问题**，现在所有功能和日志都能正常工作。

---

## 问题诊断

如果在 WSL 环境下无法检测到剪贴板内容，请按照以下步骤排查：

### 1. 启用详细日志

在 VSCode 设置中启用详细日志：

```json
{
  "docuSnap.verboseLog": true
}
```

然后打开输出面板查看日志：
- 按 `Ctrl+Shift+U` 打开输出面板
- 在下拉菜单中选择 "DocuSnap"

### 2. 检查 WSL 环境

在 WSL 终端中运行以下命令：

```bash
# 检查是否在 WSL 中
echo $WSL_DISTRO_NAME

# 检查系统信息
uname -r

# 测试 powershell.exe 是否可用
which powershell.exe

# 测试 PowerShell 调用
powershell.exe -NoProfile -Command "Write-Output 'Test'"
```

### 3. 测试剪贴板访问

在 WSL 终端中测试 PowerShell 剪贴板访问：

```bash
# 测试读取剪贴板文本
powershell.exe -NoProfile -Command "Get-Clipboard"

# 测试检测剪贴板图片
powershell.exe -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Clipboard]::ContainsImage()) { Write-Output 'HAS' } else { Write-Output 'NO' }"
```

### 4. 常见问题

#### 问题 1：找不到 powershell.exe

**症状**：日志显示 "command not found: powershell.exe"

**解决方案**：
1. 确保 Windows 路径在 WSL 的 PATH 中
2. 检查 `/etc/wsl.conf` 配置：
   ```ini
   [interop]
   enabled = true
   appendWindowsPath = true
   ```
3. 重启 WSL：`wsl --shutdown`

#### 问题 2：PowerShell 执行超时

**症状**：剪贴板检测总是超时（150ms）

**解决方案**：
1. 检查 Windows Defender 是否阻止 PowerShell
2. 尝试增加超时时间（修改源代码中的 150ms）
3. 检查 WSL 和 Windows 之间的网络连接

#### 问题 3：权限问题

**症状**：PowerShell 返回权限错误

**解决方案**：
1. 以管理员身份运行 VSCode
2. 检查 PowerShell 执行策略：
   ```powershell
   Get-ExecutionPolicy
   ```
3. 如果需要，设置执行策略：
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

### 5. 手动测试流程

1. **复制一张图片到剪贴板**
   - 在 Windows 中打开图片
   - 按 `Ctrl+C` 复制

2. **在 WSL 的 VSCode 中测试**
   - 打开一个代码文件
   - 按 `Ctrl+V`（如果启用了智能粘贴）
   - 查看是否弹出选择对话框

3. **查看日志**
   - 打开输出面板（`Ctrl+Shift+U`）
   - 选择 "DocuSnap"
   - 查找以下日志：
     ```
     canUseWindowsClipboard: { platform: 'linux', isWSL: true, result: true }
     getPowerShellCommand: using powershell.exe for WSL
     SmartPaste: checking clipboard image: { psCmd: 'powershell.exe' }
     SmartPaste: clipboard image check result: { stdout: 'HAS', hasImage: true }
     ```

### 6. 环境要求

- **WSL 版本**：WSL 2（推荐）或 WSL 1
- **Windows 版本**：Windows 10 1903+ 或 Windows 11
- **PowerShell**：Windows PowerShell 5.1+（Windows 自带）
- **VSCode**：Remote - WSL 扩展已安装

### 7. 性能优化

如果剪贴板检测较慢，可以：

1. **禁用智能粘贴**（使用手动命令）
   ```json
   {
     "docuSnap.overridePaste": false
   }
   ```

2. **使用手动命令插入**
   - 右键菜单 → DocuSnap → 从剪贴板插入图片

3. **增加超时时间**（需要修改源代码）
   - 找到 `setTimeout(() => res(false), 150)`
   - 改为 `setTimeout(() => res(false), 500)`

### 8. 调试技巧

#### 启用 VSCode 开发者工具

1. 按 `Ctrl+Shift+P`
2. 输入 "Developer: Toggle Developer Tools"
3. 查看 Console 标签页的错误信息

#### 查看扩展日志

```bash
# 在 WSL 终端中
tail -f ~/.vscode-server/data/logs/*/exthost*/output_logging_*/DocuSnap.log
```

### 9. 报告问题

如果问题仍然存在，请提供以下信息：

1. **环境信息**
   ```bash
   # WSL 版本
   wsl --version
   
   # 发行版信息
   cat /etc/os-release
   
   # VSCode 版本
   code --version
   ```

2. **日志信息**
   - 启用 `docuSnap.verboseLog`
   - 复制完整的输出日志

3. **测试结果**
   - PowerShell 命令的输出
   - 错误信息截图

4. **提交 Issue**
   - 访问：https://github.com/jsnjjnzx/DocuSnap/issues
   - 使用模板：WSL 环境问题

## 已知限制

1. **剪贴板延迟**：WSL 访问 Windows 剪贴板可能有轻微延迟
2. **大文件**：复制大图片可能需要更长时间
3. **网络文件**：网络路径的文件可能无法访问

## 替代方案

如果剪贴板功能无法正常工作，可以使用：

1. **手动选择文件**
   - 右键菜单 → DocuSnap → 插入图片
   - 选择文件对话框

2. **拖放文件**（计划中）
   - 直接拖放文件到编辑器

3. **命令行工具**（高级用户）
   - 使用 `wslpath` 转换路径
   - 手动编写 `@link@` 标记

## 贡献

如果你成功解决了 WSL 环境下的问题，欢迎：
- 提交 Pull Request 改进代码
- 分享你的解决方案
- 更新此文档

---

**最后更新**：2025-12-28  
**适用版本**：v0.3.0+
