# 注释快贴 (DocuSnap)

[![Version](https://img.shields.io/visual-studio-marketplace/v/jsnjjnzx.docusnap-assets)](https://marketplace.visualstudio.com/items?itemName=jsnjjnzx.docusnap-assets)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/jsnjjnzx.docusnap-assets)](https://marketplace.visualstudio.com/items?itemName=jsnjjnzx.docusnap-assets)
[![License](https://img.shields.io/github/license/jsnjjnzx/DocuSnap)](https://github.com/jsnjjnzx/DocuSnap/blob/main/LICENSE)

一款强大的 VS Code 扩展，让你在代码中轻松插入图片和文档链接，并支持悬浮预览。通过 `@link@` 标记，将代码注释与资源文件完美结合。

![演示](images/demo.gif)

## ✨ 核心功能

### 📎 智能资源插入

- **插入图片**: 选择图片文件，自动复制到项目资源目录并生成 `@link@` 标记
- **插入文档**: 支持 Markdown、文本、PDF 等文档类型
- **剪贴板插入**: 直接从剪贴板粘贴图片或文件
- **智能粘贴**: 自动识别剪贴板内容类型（图片/文件/路径），一键转换为 `@link@` 标记

### 🔍 悬浮预览

- **图片预览**: 鼠标悬停在 `@link@` 标记上即可预览图片
- **文档预览**: 支持 Markdown 和文本文件的内容预览
- **固定预览**: 点击悬浮窗中的"📌 固定预览"按钮，将资源固定到侧边栏预览面板

### 🗂️ 链接管理

- **链接视图**: 侧边栏显示项目中所有 `@link@` 链接
- **快速导航**: 点击链接直接跳转到代码位置
- **无效链接检测**: 自动标记失效的资源链接
- **批量清理**: 一键清理文件或项目中的无效链接
- **搜索过滤**: 快速搜索和定位特定链接

### ⚙️ 灵活配置

- **自定义资源目录**: 配置资源文件存放位置
- **注释符规则**: 支持多种编程语言的注释格式自动适配
- **覆盖粘贴**: 可选启用智能粘贴覆盖默认 Ctrl+V 行为
- **详细日志**: 开发调试时可启用详细日志输出

## 🚀 快速开始

### 安装

1. 打开 VS Code
2. 按 `Ctrl+P` 打开快速打开面板
3. 输入 `ext install jsnjjnzx.docusnap-assets`
4. 点击安装

或者在扩展市场搜索 "注释快贴" 或 "DocuSnap"。

### 基本使用

#### 方法一：命令面板

1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入 "注释快贴" 查看所有可用命令
3. 选择相应命令（如"插入代码描述图片"）
4. 选择要插入的文件

#### 方法二：右键菜单

1. 在编辑器中右键点击
2. 选择"注释快贴"子菜单
3. 选择相应操作

#### 方法三：智能粘贴

1. 复制图片文件或截图到剪贴板
2. 在代码编辑器中按 `Ctrl+V`
3. 扩展会自动识别并提示转换为 `@link@` 标记

## 📖 详细功能说明

### 1. 插入代码描述图片

**命令**: `注释快贴: 插入代码描述图片`

将图片文件插入到代码中作为注释链接。

**使用场景**:
- 为复杂算法添加流程图说明
- 在 UI 代码中引用设计稿
- 记录 API 接口的请求/响应示例截图

**示例**:
```javascript
// 用户登录流程
// @link@:images/login-flow.png
function handleLogin(username, password) {
  // ...
}
```

### 2. 插入代码描述文档

**命令**: `注释快贴: 插入代码描述文档`

插入文档文件（Markdown、文本、PDF）的链接。

**使用场景**:
- 链接详细的技术文档
- 引用需求说明文档
- 关联测试用例文档

**示例**:
```python
# 详细算法说明见文档
# @link@:docs/sorting-algorithm.md
def quick_sort(arr):
    # ...
```

### 3. 从剪贴板插入

**命令**: `注释快贴: 从剪贴板插入代码描述图片/文档`

直接从剪贴板粘贴图片或文件。

**支持的剪贴板内容**:
- 截图（Windows/WSL）
- 复制的文件
- 文件路径文本

### 4. 智能粘贴（确认式粘贴）

**命令**: `注释快贴: 确认式粘贴为 @link@`

自动识别剪贴板内容类型并智能处理。

**工作流程**:
1. 检测剪贴板内容类型
2. 如果是图片：保存到资源目录并生成链接
3. 如果是文件：复制到资源目录并生成链接
4. 如果是文件路径：验证后生成链接
5. 如果是普通文本：执行默认粘贴

**可选配置**: 在设置中启用 `docuSnap.overridePaste` 可以让智能粘贴覆盖默认的 `Ctrl+V` 行为。

### 5. 悬浮预览

将鼠标悬停在 `@link@` 标记上，即可看到：
- **图片**: 直接显示图片内容
- **Markdown/文本**: 显示文件内容（前 2000 字符）
- **其他文件**: 显示"打开附件"链接

点击悬浮窗中的 **📌 固定预览** 按钮，可以将资源固定到侧边栏的预览面板中，方便长时间查看。

### 6. 链接管理视图

在侧边栏的"注释快贴"图标下，有两个视图：

#### 链接视图
- 显示项目中所有 `@link@` 链接
- 按文件分组展示
- 点击链接跳转到代码位置
- 右键菜单提供删除、清理等操作

**工具栏按钮**:
- 🔄 **刷新**: 重新扫描项目链接
- 👁️ **切换显示**: 只显示无效链接 / 显示所有链接
- 🧹 **清理**: 批量清理当前文件的无效链接

#### 预览视图
- 显示固定的资源预览
- 支持图片和文本文档
- 点击"清空预览"按钮可关闭预览

### 7. 清理无效链接

**命令**: `注释快贴: 清理无效链接`

扫描项目中所有 `@link@` 标记，检测并清理指向不存在文件的链接。

**清理选项**:
- 清理单个链接（右键菜单）
- 清理当前文件的无效链接
- 清理整个项目的无效链接

### 8. 诊断信息

**命令**: `注释快贴: 诊断信息`

显示扩展的运行状态和配置信息，用于排查问题。

## ⚙️ 配置选项

在 VS Code 设置中搜索 "docuSnap" 可以找到以下配置项：

### `docuSnap.assetsDir`

**类型**: `string`  
**默认值**: `.vscode/code-assets`

资源文件存放目录。可以是相对路径（相对于工作区根目录）或绝对路径。

**示例**:
```json
{
  "docuSnap.assetsDir": ".vscode/code-assets"  // 相对路径
}
```

```json
{
  "docuSnap.assetsDir": "D:/MyProject/assets"  // 绝对路径
}
```

### `docuSnap.overridePaste`

**类型**: `boolean`  
**默认值**: `false`

启用后，在编辑器中按 `Ctrl+V` 会触发智能粘贴功能。

**建议**: 如果你经常需要粘贴图片和文件，可以启用此选项。如果你更喜欢手动触发，保持关闭即可。

### `docuSnap.verboseLog`

**类型**: `boolean`  
**默认值**: `false`

启用详细日志输出，用于调试。开启后会在输出面板的"DocuSnap"频道中显示详细的运行日志。

### `docuSnap.commentTokenRules`

**类型**: `array`  
**默认值**: 
```json
[
  "{c,cpp,h,hpp,js,jsx,ts,tsx,mjs,cjs,java,cs,go,rs,kt,scala,swift}-{//}",
  "{py,sh,bash,zsh,ps1,bat,toml,yaml,yml,r,pl,rb,coffee}-{#}",
  "{lua,sql,hs}-{--}",
  "{m,erl}-%"
]
```

定义不同文件扩展名对应的注释符号。

**语法**: `{扩展名列表}-{注释符}`

**示例**: 添加自定义规则
```json
{
  "docuSnap.commentTokenRules": [
    "{c,cpp,h,hpp,js,jsx,ts,tsx,mjs,cjs,java,cs,go,rs,kt,scala,swift}-{//}",
    "{py,sh,bash,zsh,ps1,bat,toml,yaml,yml,r,pl,rb,coffee}-{#}",
    "{lua,sql,hs}-{--}",
    "{m,erl}-%",
    "{vue,html,xml}-{<!-- -->}"  // 自定义规则
  ]
}
```

## 🎯 使用技巧

### 技巧 1: 快速截图并插入

1. 使用截图工具（如 Windows 的 `Win+Shift+S`）截图
2. 在代码编辑器中按 `Ctrl+V`
3. 扩展自动保存截图并生成链接

### 技巧 2: 批量插入多个图片

1. 在文件管理器中选择多个图片文件
2. 复制（`Ctrl+C`）
3. 在代码编辑器中按 `Ctrl+V`
4. 扩展会为每个文件生成一行 `@link@` 标记

### 技巧 3: 组织资源文件

建议按类型组织资源文件：
```
.vscode/code-assets/
├── images/          # 图片文件
│   ├── ui/         # UI 相关
│   ├── flow/       # 流程图
│   └── api/        # API 截图
└── docs/           # 文档文件
    ├── specs/      # 规格说明
    └── guides/     # 使用指南
```

### 技巧 4: 定期清理无效链接

随着项目演进，一些资源文件可能被删除或移动。建议定期运行"清理无效链接"命令，保持项目整洁。

### 技巧 5: 结合 Git 使用

将资源目录添加到 Git 版本控制中：
```bash
git add .vscode/code-assets
git commit -m "Add code documentation assets"
```

这样团队成员都能看到相同的文档和图片。

## 🔧 故障排除

### 问题 1: 粘贴图片没有反应

**可能原因**:
- 未启用 `docuSnap.overridePaste` 配置
- 剪贴板中不是图片内容

**解决方案**:
- 检查设置中的 `docuSnap.overridePaste` 选项
- 或使用命令"从剪贴板插入代码描述图片/文档"

### 问题 2: 悬浮预览不显示

**可能原因**:
- `@link@` 标记格式不正确
- 文件路径错误

**解决方案**:
- 确保格式为 `@link@:相对路径`
- 检查文件是否存在于资源目录中
- 使用"诊断信息"命令查看详细信息

### 问题 3: WSL 环境下无法粘贴图片

**可能原因**:
- WSL 与 Windows 剪贴板交互问题

**解决方案**:
- 确保 WSL 版本为 WSL2
- 检查是否安装了 `wslu` 包
- 启用详细日志查看具体错误

### 问题 4: 注释符号不正确

**可能原因**:
- 当前文件类型未配置注释规则

**解决方案**:
- 在 `docuSnap.commentTokenRules` 中添加对应文件类型的规则
- 参考配置选项章节的示例

## 🤝 贡献

欢迎提交问题和功能建议！

- GitHub 仓库: [https://github.com/jsnjjnzx/DocuSnap](https://github.com/jsnjjnzx/DocuSnap)
- 问题反馈: [https://github.com/jsnjjnzx/DocuSnap/issues](https://github.com/jsnjjnzx/DocuSnap/issues)

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 🙏 支持

如果这个扩展对你有帮助，欢迎：
- ⭐ 在 GitHub 上给项目加星
- 📝 在市场上留下评价
- 🐛 报告问题和建议
- 💡 分享给更多开发者

---

**享受更高效的代码文档体验！** 🎉
