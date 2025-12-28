# DocuSnap

[![Version](https://img.shields.io/visual-studio-marketplace/v/jsnjjnzx.docusnap-assets)](https://marketplace.visualstudio.com/items?itemName=jsnjjnzx.docusnap-assets)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/jsnjjnzx.docusnap-assets)](https://marketplace.visualstudio.com/items?itemName=jsnjjnzx.docusnap-assets)
[![License](https://img.shields.io/github/license/jsnjjnzx/DocuSnap)](https://github.com/jsnjjnzx/DocuSnap/blob/main/LICENSE)

A powerful VS Code extension that lets you easily insert image and document links in your code with hover preview support. Use `@link@` tags to seamlessly connect code comments with resource files.

[中文文档](README.md) | English

![Demo](images/demo.gif)

## ✨ Key Features

### 📎 Smart Resource Insertion

- **Insert Images**: Select image files, automatically copy to project assets directory and generate `@link@` tags
- **Insert Documents**: Support Markdown, text, PDF and other document types
- **Clipboard Insert**: Paste images or files directly from clipboard
- **Smart Paste**: Auto-detect clipboard content type (image/file/path) and convert to `@link@` tags

### 🔍 Hover Preview

- **Image Preview**: Hover over `@link@` tags to preview images
- **Document Preview**: Preview content of Markdown and text files
- **Pin Preview**: Click "📌 Pin Preview" button in hover to pin resource to sidebar preview panel

### 🗂️ Link Management

- **Links View**: Sidebar shows all `@link@` links in project
- **Quick Navigation**: Click links to jump to code location
- **Invalid Link Detection**: Auto-mark broken resource links
- **Batch Cleanup**: One-click cleanup of invalid links in file or project
- **Search & Filter**: Quickly search and locate specific links

### ⚙️ Flexible Configuration

- **Custom Assets Directory**: Configure resource file storage location
- **Comment Token Rules**: Auto-adapt comment formats for multiple programming languages
- **Override Paste**: Optionally enable smart paste to override default Ctrl+V behavior
- **Verbose Logging**: Enable detailed logging for development debugging

## 🚀 Quick Start

### Installation

1. Open VS Code
2. Press `Ctrl+P` to open Quick Open
3. Type `ext install jsnjjnzx.docusnap-assets`
4. Click Install

Or search for "DocuSnap" in the Extensions Marketplace.

### Basic Usage

#### Method 1: Command Palette

1. Press `Ctrl+Shift+P` to open Command Palette
2. Type "DocuSnap" to see all available commands
3. Select a command (e.g., "Insert description image")
4. Choose files to insert

#### Method 2: Context Menu

1. Right-click in editor
2. Select "DocuSnap" submenu
3. Choose an action

#### Method 3: Smart Paste

1. Copy image file or screenshot to clipboard
2. Press `Ctrl+V` in code editor
3. Extension auto-detects and prompts to convert to `@link@` tag

## 📖 Detailed Features

### 1. Insert Description Image

**Command**: `DocuSnap: Insert description image`

Insert image files as comment links in code.

**Use Cases**:
- Add flowchart explanations for complex algorithms
- Reference design mockups in UI code
- Record API request/response example screenshots

**Example**:
```javascript
// User login flow
// @link@:images/login-flow.png
function handleLogin(username, password) {
  // ...
}
```

### 2. Insert Description Document

**Command**: `DocuSnap: Insert description document`

Insert links to document files (Markdown, text, PDF).

**Use Cases**:
- Link detailed technical documentation
- Reference requirement specification documents
- Associate test case documents

**Example**:
```python
# See document for detailed algorithm explanation
# @link@:docs/sorting-algorithm.md
def quick_sort(arr):
    # ...
```

### 3. Insert from Clipboard

**Command**: `DocuSnap: Insert image/document from clipboard`

Paste images or files directly from clipboard.

**Supported Clipboard Content**:
- Screenshots (Windows/WSL)
- Copied files
- File path text

### 4. Smart Paste (Confirm Paste)

**Command**: `DocuSnap: Confirm paste as @link@`

Auto-detect clipboard content type and handle intelligently.

**Workflow**:
1. Detect clipboard content type
2. If image: Save to assets directory and generate link
3. If file: Copy to assets directory and generate link
4. If file path: Validate and generate link
5. If plain text: Execute default paste

**Optional Config**: Enable `docuSnap.overridePaste` in settings to let smart paste override default `Ctrl+V` behavior.

### 5. Hover Preview

Hover mouse over `@link@` tags to see:
- **Images**: Display image content directly
- **Markdown/Text**: Show file content (first 2000 characters)
- **Other Files**: Show "Open attachment" link

Click **📌 Pin Preview** button in hover to pin resource to sidebar preview panel for extended viewing.

### 6. Link Management View

Under the "DocuSnap" icon in sidebar, there are two views:

#### Links View
- Shows all `@link@` links in project
- Grouped by file
- Click links to jump to code location
- Right-click menu provides delete, cleanup and other actions

**Toolbar Buttons**:
- 🔄 **Refresh**: Re-scan project links
- 👁️ **Toggle Display**: Show only invalid links / Show all links
- 🧹 **Clean**: Batch cleanup invalid links in current file

#### Preview View
- Shows pinned resource preview
- Supports images and text documents
- Click "Clear Preview" button to close preview

### 7. Clean Invalid Links

**Command**: `DocuSnap: Clean invalid links`

Scan all `@link@` tags in project, detect and clean links pointing to non-existent files.

**Cleanup Options**:
- Clean single link (context menu)
- Clean invalid links in current file
- Clean invalid links in entire project

### 8. Diagnostics

**Command**: `DocuSnap: Diagnostics`

Display extension runtime status and configuration info for troubleshooting.

## ⚙️ Configuration Options

Search for "docuSnap" in VS Code settings to find these options:

### `docuSnap.assetsDir`

**Type**: `string`  
**Default**: `.vscode/code-assets`

Resource file storage directory. Can be relative path (relative to workspace root) or absolute path.

**Examples**:
```json
{
  "docuSnap.assetsDir": ".vscode/code-assets"  // Relative path
}
```

```json
{
  "docuSnap.assetsDir": "D:/MyProject/assets"  // Absolute path
}
```

### `docuSnap.overridePaste`

**Type**: `boolean`  
**Default**: `false`

When enabled, pressing `Ctrl+V` in editor triggers smart paste functionality.

**Recommendation**: Enable if you frequently paste images and files. Keep disabled if you prefer manual triggering.

### `docuSnap.verboseLog`

**Type**: `boolean`  
**Default**: `false`

Enable verbose logging for debugging. When enabled, detailed runtime logs appear in Output panel's "DocuSnap" channel.

### `docuSnap.commentTokenRules`

**Type**: `array`  
**Default**: 
```json
[
  "{c,cpp,h,hpp,js,jsx,ts,tsx,mjs,cjs,java,cs,go,rs,kt,scala,swift}-{//}",
  "{py,sh,bash,zsh,ps1,bat,toml,yaml,yml,r,pl,rb,coffee}-{#}",
  "{lua,sql,hs}-{--}",
  "{m,erl}-%"
]
```

Define comment tokens for different file extensions.

**Syntax**: `{extension list}-{comment token}`

**Example**: Add custom rules
```json
{
  "docuSnap.commentTokenRules": [
    "{c,cpp,h,hpp,js,jsx,ts,tsx,mjs,cjs,java,cs,go,rs,kt,scala,swift}-{//}",
    "{py,sh,bash,zsh,ps1,bat,toml,yaml,yml,r,pl,rb,coffee}-{#}",
    "{lua,sql,hs}-{--}",
    "{m,erl}-%",
    "{vue,html,xml}-{<!-- -->}"  // Custom rule
  ]
}
```

## 🎯 Tips & Tricks

### Tip 1: Quick Screenshot and Insert

1. Use screenshot tool (e.g., Windows `Win+Shift+S`)
2. Press `Ctrl+V` in code editor
3. Extension auto-saves screenshot and generates link

### Tip 2: Batch Insert Multiple Images

1. Select multiple image files in file manager
2. Copy (`Ctrl+C`)
3. Press `Ctrl+V` in code editor
4. Extension generates one `@link@` tag per file

### Tip 3: Organize Resource Files

Recommended organization by type:
```
.vscode/code-assets/
├── images/          # Image files
│   ├── ui/         # UI related
│   ├── flow/       # Flowcharts
│   └── api/        # API screenshots
└── docs/           # Document files
    ├── specs/      # Specifications
    └── guides/     # User guides
```

### Tip 4: Regular Cleanup of Invalid Links

As projects evolve, some resource files may be deleted or moved. Regularly run "Clean invalid links" command to keep project tidy.

### Tip 5: Use with Git

Add assets directory to Git version control:
```bash
git add .vscode/code-assets
git commit -m "Add code documentation assets"
```

This way team members can see the same documentation and images.

## 🔧 Troubleshooting

### Issue 1: Pasting Image Has No Effect

**Possible Causes**:
- `docuSnap.overridePaste` not enabled
- Clipboard doesn't contain image content

**Solutions**:
- Check `docuSnap.overridePaste` option in settings
- Or use command "Insert image/document from clipboard"

### Issue 2: Hover Preview Not Showing

**Possible Causes**:
- `@link@` tag format incorrect
- File path error

**Solutions**:
- Ensure format is `@link@:relative-path`
- Check if file exists in assets directory
- Use "Diagnostics" command to view details

### Issue 3: Cannot Paste Images in WSL

**Possible Causes**:
- WSL and Windows clipboard interaction issues

**Solutions**:
- Ensure WSL version is WSL2
- Check if `wslu` package is installed
- Enable verbose logging to see specific errors

### Issue 4: Incorrect Comment Token

**Possible Causes**:
- Current file type not configured in comment rules

**Solutions**:
- Add rule for file type in `docuSnap.commentTokenRules`
- Refer to examples in Configuration Options section

## 🤝 Contributing

Issues and feature suggestions welcome!

- GitHub Repository: [https://github.com/jsnjjnzx/DocuSnap](https://github.com/jsnjjnzx/DocuSnap)
- Issue Tracker: [https://github.com/jsnjjnzx/DocuSnap/issues](https://github.com/jsnjjnzx/DocuSnap/issues)

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 🙏 Support

If this extension helps you, please:
- ⭐ Star the project on GitHub
- 📝 Leave a review on the marketplace
- 🐛 Report issues and suggestions
- 💡 Share with more developers

---

**Enjoy a more efficient code documentation experience!** 🎉
