# Changelog · [中文](CHANGELOG.md)

## [0.2.5] - 2025-10-08
### Performance
- Noticeably faster Smart Paste when overriding Ctrl+V:
	- Fast path for plain-text paste that skips external probes;
	- Add ~150ms timeout to clipboard image/file probes to avoid blocking typing;
	- Dialogs are non-modal to reduce interruption.

### Behavior
- Stricter text-path detection: only treat as a file when the path exists and is a supported type (png/jpg/jpeg/gif/svg/webp/md/txt/pdf); prevents mis-detecting directories or unrelated text.

### CI
- Publish workflow is now manual-only (workflow_dispatch). Regular pushes won’t trigger emails; use Actions -> Run workflow to publish.


## [0.2.4] - 2025-09-16
### Changes
- Minor optimizations

## [0.2.3] - 2025-09-15
### Changes
- Move to “rules as the single source of truth”: remove `docuSnap.commentTokenMap` and rely on `docuSnap.commentTokenRules` only.
- Ship sensible default rules for common languages out of the box.
- Update deletion command: `docusnap.deleteCommentTokens` now removes selected extensions from rules (rewrite lines; drop empty ones).

### UX
- When the current file’s extension has no matching rule, insertion is blocked with a modal prompt and a one-click action to open Settings for `docuSnap.commentTokenRules`.

## [0.2.2] - 2025-09-15
### Added
- New setting `docuSnap.verboseLog`: enable a “verbose logging” mode to emit candidate samples, per-file scanning, deletion details, etc.

### Improvements
- Quieter default logging: keep only start/end and key counts; the cleanup flow no longer forces the log panel to open.
- Consolidated noisy debug prints under the verbose toggle; diagnostics candidate samples are also printed only in verbose mode.
- Activation banner is now printed only in verbose mode.

## [0.2.1] - 2025-09-15
### Added
- Smart Paste dialog now includes a “Rename & Insert” button:
	- Choose renaming upfront to avoid a second prompt;
	- Rename clipboard image/files before copying into assets (invalid chars sanitized; auto-avoid name conflicts).

### Improvements
- Links view overflow menu wording refined: “Clean invalid links (File)” -> “Clean invalid links”.

## [0.2.0] - 2025-09-14
### Added
- Links sidebar view (Activity Bar): list all `@link@` items grouped by file, supporting:
	- Jump to source by click;
	- Overflow menu “…” actions: Refresh, Toggle “Show only missing”, Clean invalid links (File);
	- Context action on a single link: “Remove this link”;
	- Auto refresh on document and assets directory changes (with debounce).
- Localization & icon:
	- Activity Bar container title and view name are localized via NLS (shown as “注释快贴” and “链接” in Chinese locale);
	- New `images/links.svg` icon for the sidebar.

### Improvements
- More robust and efficient `@link@` parsing and invalid-link detection:
	- Regex supports halfwidth/fullwidth colon and quoted paths;
	- Workspace scan includes in-memory text for opened-but-unsaved documents;
	- Existence check strategy: fs.stat for “File” scope; for “Workspace” scope prefer the prebuilt assets set, then fall back to fs.stat;
	- Concurrency-limited scanning and existence checks;
	- (Already available) configurable include/exclude globs to constrain the search scope.
- View actions now live only in the view’s “…” overflow menu to match native styling and reduce clutter.

### Fixed
- When a referenced asset was deleted, dangling links are now reliably detected and can be cleaned.

## [0.1.3] - 2025-09-14
### Fixed
- After an asset file was deleted in the assets folder, the "Clean invalid links" command failed to detect the dangling links in code. We now perform an on-demand filesystem existence check (fs.stat) for each `@link@` to ensure deleted targets are identified. For workspace scope, the prebuilt asset set is still used for performance and falls back to fs check when needed.
### Docs
- Enriched README with a quick demo GIF, examples and tips; completed English README

## [0.1.2] - 2025-09-14
### Changed
- Updated extension icon (clearer visuals and improved contrast for light/dark themes)

## [0.1.1] - 2025-09-14
### Improvements
- Improved performance of "Clean invalid links" for large projects (added include/exclude globs, parallel parsing, and progress reporting)

## [0.1.0] - 2025-09-14
### Added
- Initial public release on the VS Code Marketplace
