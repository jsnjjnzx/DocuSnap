# 注释快贴（DocuSnap） · [English](README.en.md)

让你在代码中以 @link@ 标记插入与这段代码有关的图片/文档，并在悬浮时预览。

## 快速预览

<img src="images/demo.gif" alt="DocuSnap 使用演示" width="960" />

## 功能
- 右键编辑器：
  - 插入代码描述图片
  - 插入代码描述文档
  - 从剪贴板插入代码描述图片（Windows）
- 标记格式（唯一）：`<注释前缀> @link@:relative/path.ext`
  - C/C++/C#/Java/JS/TS/Go/Rust 等：`// @link@:images/foo.png`
  - Python/Shell/PowerShell/YAML/TOML/R/Ruby/Perl 等：`# @link@:docs/bar.md`
  - SQL/Lua/Haskell：`-- @link@:images/foo.png`
  - MATLAB/Erlang：`% @link@:images/foo.png`
- 悬浮预览：
  - 图片：直接显示
  - 文档（md/txt）：展示前 20 行片段
  - 其他类型：提供“在编辑器中打开”链接

## 配置
- `docuSnap.assetsDir`（默认：`.vscode/code-assets`）
  - 相对路径：相对工作区根目录
  - 绝对路径：直接使用该目录
- `docuSnap.overridePaste`（默认：false）
  - 开启后，用确认式粘贴覆盖编辑器中的 Ctrl+V：当剪贴板包含图片或本地文件路径时，先询问是否插入 `@link@`，否则回退为普通粘贴。

## 使用
1. 在代码中光标处右键，选择“插入代码描述图片/文档”
2. 选择一个或多个文件，插件会复制到配置的资产目录（图片放入 `images/`，文档放入 `docs/`）
3. 插件会在光标处插入形如 `<注释前缀> @link@:images/name.png` 的标记
4. 将鼠标悬停在该标记上可预览

## 捐赠
  如果你觉得这个扩展对你有帮助，请喝一杯咖啡☕️呗：
<img src="images/donate.png" alt="DocuSnap 捐赠" width="960" />
## 许可
MIT
