# 更新日志

## [1.0.0] - 2025-12-28

### 🎉 首次发布

这是 DocuSnap（注释快贴）的首个正式版本，提供完整的代码注释资源管理功能。

#### ✨ 核心功能

- **智能资源插入**
  - 插入图片文件到代码注释
  - 插入文档文件（Markdown、文本、PDF）
  - 从剪贴板直接插入图片和文件
  - 智能粘贴：自动识别剪贴板内容类型

- **悬浮预览**
  - 鼠标悬停预览图片
  - 预览 Markdown 和文本文件内容
  - 固定预览功能：将资源固定到侧边栏

- **链接管理**
  - 侧边栏链接视图：显示所有 `@link@` 标记
  - 快速导航到代码位置
  - 无效链接检测和标记
  - 批量清理无效链接
  - 搜索和过滤链接

- **灵活配置**
  - 自定义资源目录位置
  - 多语言注释符号规则配置
  - 可选的智能粘贴覆盖
  - 详细日志输出选项

#### 🔧 技术特性

- 支持 Windows 和 WSL 环境
- 自动处理文件名冲突
- 遵循 VS Code 的 files.exclude 和 search.exclude 配置
- 完整的中英文双语支持

#### 📦 支持的文件类型

- **图片**: PNG, JPG, JPEG, GIF, SVG, WebP
- **文档**: Markdown (.md), 文本 (.txt), PDF (.pdf)

#### 🌍 语言支持

- 简体中文
- English

---

**完整文档**: [README.md](README.md)  
**GitHub 仓库**: [https://github.com/jsnjjnzx/DocuSnap](https://github.com/jsnjjnzx/DocuSnap)
