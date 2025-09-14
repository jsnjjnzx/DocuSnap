# DocuSnap — Code Annotation, Visual Preview · [中文](README.md)

DocuSnap lets you insert lightweight annotation tags in code comments like `@link@:relative/path.ext` and preview linked images or docs on hover. Organize assets in your project and keep code and documentation closely connected.

## Quick Look

<img src="images/demo.gif" alt="DocuSnap Demo" width="960" />

## Features
- Editor context menu:
  - Insert image for code description
  - Insert document for code description
  - Insert image from clipboard (Windows)
- Single tag format in comments: `<line-comment-prefix> @link@:relative/path.ext`
  - C/C++/C#/Java/JS/TS/Go/Rust: `// @link@:images/foo.png`
  - Python/Shell/PowerShell/YAML/TOML/R/Ruby/Perl: `# @link@:docs/bar.md`
  - SQL/Lua/Haskell: `-- @link@:images/foo.png`
  - MATLAB/Erlang: `% @link@:images/foo.png`
- Hover preview:
  - Images: rendered directly
  - Docs (md/txt): shows first 20 lines
  - Other types: link to open in editor

## Settings
- `docuSnap.assetsDir` (default: `.vscode/code-assets`)
  - Relative path: resolved from workspace root
  - Absolute path: used as-is
- `docuSnap.overridePaste` (default: false)
  - When enabled, overrides Ctrl+V with a confirm flow: if clipboard contains images or local file paths, ask to insert `@link@`; otherwise fall back to normal paste.

## Usage
1. Right-click in the editor and choose “Insert image/document for code description”.
2. Pick one or more files. They’ll be copied into the configured assets directory (images go to `images/`, documents go to `docs/`).
3. The extension inserts a tag like `<prefix> @link@:images/name.png` at the cursor.
4. Hover the tag to preview.

## License
MIT
