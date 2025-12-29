# 脚本使用说明

本目录包含用于打包和发布 DocuSnap 扩展的脚本工具。

## 📁 脚本文件

### Windows 批处理脚本（推荐）
- `package.bat` - 打包扩展为 .vsix 文件
- `publish.bat` - 发布扩展到 VS Code 市场
- `test-build.bat` - 测试构建环境和依赖

### PowerShell 脚本
- `package.ps1` - 打包扩展（PowerShell 版本）
- `publish.ps1` - 发布扩展（PowerShell 版本）

**注意**：PowerShell 脚本需要设置执行策略才能运行。如果遇到权限问题，建议使用 .bat 批处理脚本。

## 🚀 使用方法

### 1. 测试构建环境

首次使用前，建议先运行测试脚本检查环境：

```cmd
cd scripts
test-build.bat
```

该脚本会检查：
- ✅ node_modules 是否存在
- ✅ TypeScript 编译器是否可用
- ✅ 编译是否成功
- ✅ 输出文件是否生成
- ✅ vsce 工具是否安装

### 2. 打包扩展

**方式 1：双击运行**
- 直接双击 `package.bat` 文件

**方式 2：命令行运行**
```cmd
cd scripts
package.bat
```

**打包流程**：
1. 检查并安装依赖（如果需要）
2. 编译 TypeScript 代码
3. 打包生成 .vsix 文件

**输出结果**：
- 在项目根目录生成 `docusnap-assets-1.0.0.vsix` 文件

### 3. 发布到市场

**前置条件**：
1. 已创建 Azure DevOps 账号
2. 已创建发布者账号（jsnjjnzx）
3. 已生成 Personal Access Token (PAT)
4. 已登录：`vsce login jsnjjnzx`

**发布步骤**：

```cmd
cd scripts
publish.bat
```

脚本会提示你输入 `YES` 确认发布。

**发布流程**：
1. 检查发布者登录状态
2. 显示版本信息并要求确认
3. 编译 TypeScript 代码
4. 打包扩展
5. 发布到 VS Code 市场

## ⚠️ 常见问题

### 问题 1：PowerShell 脚本无法运行

**错误信息**：
```
无法加载文件，因为在此系统上禁止运行脚本
```

**解决方案 1**：使用批处理脚本（推荐）
```cmd
package.bat
```

**解决方案 2**：临时允许 PowerShell 脚本
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\package.ps1
```

**解决方案 3**：永久修改执行策略（需要管理员权限）
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 问题 2：npm 命令不可用

**错误信息**：
```
'npm' 不是内部或外部命令
```

**解决方案**：
1. 安装 Node.js：https://nodejs.org/
2. 重启命令行窗口
3. 验证安装：`node --version` 和 `npm --version`

### 问题 3：vsce 命令不可用

**错误信息**：
```
'vsce' 不是内部或外部命令
```

**解决方案**：
```cmd
npm install -g vsce
```

或者使用 npx 运行：
```cmd
npx vsce package
npx vsce publish
```

### 问题 4：编译失败

**错误信息**：
```
Error: Compilation failed
```

**解决方案**：
1. 检查 TypeScript 代码是否有语法错误
2. 确保依赖已安装：`npm install`
3. 手动编译查看详细错误：`npx tsc -p ./`

### 问题 5：未登录发布者账号

**错误信息**：
```
Error: Publisher credentials not found
```

**解决方案**：
```cmd
vsce login jsnjjnzx
```

然后输入你的 Personal Access Token。

### 问题 6：Token 过期

**错误信息**：
```
Error: Failed request: (401)
```

**解决方案**：
1. 在 Azure DevOps 生成新的 PAT
2. 重新登录：`vsce login jsnjjnzx`

### 问题 7：版本号冲突

**错误信息**：
```
Error: Extension version X.X.X already exists
```

**解决方案**：
1. 更新 `package.json` 中的版本号
2. 确保新版本号大于已发布的版本

## 🔧 手动操作

如果脚本无法正常工作，可以手动执行以下命令：

### 手动打包
```cmd
# 1. 安装依赖
npm install

# 2. 编译代码
npm run compile

# 3. 打包扩展
npm run package
```

### 手动发布
```cmd
# 1. 登录（首次）
vsce login jsnjjnzx

# 2. 编译代码
npm run compile

# 3. 发布
npm run publish
```

## 📋 发布前检查清单

在运行 `publish.bat` 之前，请确认：

- [ ] 版本号已更新（package.json）
- [ ] CHANGELOG.md 已更新
- [ ] README.md 内容完整
- [ ] 所有功能已测试
- [ ] 代码已编译无错误
- [ ] 已登录发布者账号
- [ ] Personal Access Token 未过期

## 🔗 相关链接

- [VS Code 扩展发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [vsce 工具文档](https://github.com/microsoft/vscode-vsce)
- [Azure DevOps](https://dev.azure.com/)
- [创建 Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token)

## 💡 提示

1. **首次打包**：运行 `test-build.bat` 检查环境
2. **测试安装**：打包后使用 `code --install-extension *.vsix` 本地测试
3. **版本管理**：遵循语义化版本规范（Major.Minor.Patch）
4. **Token 安全**：不要将 PAT 提交到代码仓库
5. **发布频率**：避免频繁发布小更新，建议积累一定功能后再发布

---

**最后更新**：2025-12-28
