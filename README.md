# Selection Markdown Exporter

A VS Code extension that exports selected files and folders to a single markdown file, perfect for AI analysis and documentation generation.

## Features

- **Multi-selection support**: Export single files, multiple files, folders, or mixed selections
- **Automatic timestamping**: Output files automatically get timestamps to prevent overwrites
- **Smart ignore system**: Respects .gitignore and custom ignore patterns with strict priority order
- **Binary file handling**: Automatically detects and excludes binary files with placeholders
- **Clean architecture**: Well-organized codebase with proper separation of concerns
- **Configurable**: Extensive configuration options for all aspects of export
- **Cross-platform**: Works on macOS, Windows, and Linux

## Usage

### Context Menu (Recommended)

1. **Select files/folders** in the Explorer
2. **Right-click** and select "Export to Markdown"
3. The extension will export your selection to a markdown file

### Command Palette

1. Open Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type "Export to Markdown"
3. Select the command to export the entire workspace

## Selection Behavior

The extension handles different selection scenarios:

- **Single folder**: Exports the folder recursively
- **Multiple folders**: Exports all folders recursively
- **Files only**: Exports only the selected files
- **Mixed selection**: Exports the union of all selected items
- **No selection**: Exports the entire workspace root

## Configuration

All settings are available under `markdownExport.*` in VS Code settings:

### Output Settings

- `markdownExport.outputFile`: Base output file name (default: `FULL_CODE.md`)
  - Relative to workspace root
  - Example: `docs/export.md`
  - A timestamp is ALWAYS appended; this cannot be disabled.
  - Final naming rule:
    1. Extract base name without extension
    2. Extract extension
    3. Append `_YYYY-MM-DD_HH-mm-ss`
    4. Reassemble `<basename>_<timestamp><extension>`
  - **Format**: `<basename>_YYYY-MM-DD_HH-mm-ss.<extension>`
  - **Examples**:
    - `FULL_CODE.md` → `FULL_CODE_2025-11-18_00-12-44.md`
    - `dump.md` → `dump_2025-11-18_00-12-44.md`
    - `code.txt` → `code_2025-11-18_00-12-44.txt`

### Ignore Settings

#### Priority Order (Strict)
1. `.gitignore` patterns (highest priority)
2. `markdownExport.additionalIgnore` (exact relative paths)
3. Output file itself (base and current timestamped version automatically ignored for the run)
4. `markdownExport.binaryFiles` (exact relative paths)
5. `markdownExport.binaryFileExtensions` (extension-based)

#### Settings

- `markdownExport.additionalIgnore`: Array of exact relative paths to ignore
  ```json
  "markdownExport.additionalIgnore": [
    "node_modules",
    "dist",
    "build",
    ".env"
  ]
  ```

- `markdownExport.binaryFiles`: Array of exact file paths to treat as binary
  ```json
  "markdownExport.binaryFiles": [
    "assets/logo.png",
    "data/database.sqlite"
  ]
  ```

- `markdownExport.binaryFileExtensions`: Array of file extensions to treat as binary
  ```json
  "markdownExport.binaryFileExtensions": [
    "png", "jpg", "jpeg", "gif", "bmp", "webp",
    "mp4", "mov", "avi", "mkv", "webm",
    "pdf", "doc", "docx", "xls", "xlsx",
    "zip", "rar", "7z", "gz", "tar",
    "exe", "dll", "so", "dylib"
  ]
  ```

### Default Binary Extensions

The extension includes these default binary extensions:
- **Images**: png, jpg, jpeg, gif, bmp, webp, tif, tiff, ico, avif, heic, heif
- **Videos**: mp4, mov, avi, mkv, webm, mpeg, mpg, 3gp, ogv
- **Documents**: pdf, doc, docx, xls, xlsx, ppt, pptx
- **Archives**: zip, rar, 7z, gz, tar
- **Executables**: exe, dll, so, dylib

## Output Format

The generated markdown file includes:

1. **Index section**: Links to all exported files
2. **File sections**: Each file with proper syntax highlighting
3. **Binary placeholders**: For binary files with descriptive message

### Example Output

```markdown
# Project Code Export

## Index

- [src/index.ts](#src-index-ts)
- [package.json](#package-json)
- [README.md](#readme-md)

---

## src/index.ts

```typescript
import * as vscode from 'vscode';
// ... code content
```

---

## package.json

```json
{
  "name": "my-project"
  // ... code content
```

---

## assets/logo.png

This is a binary or unsupported file type. Content not included.

---
```

## Changelog

### v1.0.9
- Changed readme

### v1.0.8
- Timestamp bug fix in file generation
- Icon and banner for extension page

### v1.0.7
- Mandatory timestamp appended to every export file name (cannot be disabled)
- Dynamic ignore of the exact timestamped output file prevents self-inclusion

### v1.0.6
- Cleanup of duplicate scaffold and compiled JS sources

### v1.0.5
- Minor internal improvements

### v1.0.1
- Initial introduction of timestamp concept (now enforced by later versions)

### v1.0.0
- Initial release with core functionality
- Multi-selection support
- Configurable ignore system with strict priority order
- Binary file handling with comprehensive defaults
- Clean architecture implementation
- Proper .gitignore parsing using ignore npm package
- Fixed all critical bugs from previous versions