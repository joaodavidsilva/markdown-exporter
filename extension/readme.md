# Project Markdown Exporter

A VS Code extension that exports selected files and folders to a single markdown file, perfect for AI analysis and documentation generation.

## Features

- **Multi-selection support**: Export single files, multiple files, folders, or mixed selections
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

- `markdownExport.outputFile`: Output file name (default: `FULL_CODE.md`)
  - Relative to workspace root
  - Example: `docs/export.md`

### Ignore Settings

#### Priority Order (Strict)
1. `.gitignore` patterns (highest priority)
2. `markdownExport.additionalIgnore` (exact relative paths)
3. Output file itself (automatically ignored)
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

## Architecture

The extension follows a clean architecture:

```
vscode-extension/
├── src/
│   ├── commands/          # Command handlers
│   │   └── exportCommand.ts
│   ├── core/             # Core business logic
│   │   ├── paths.ts
│   │   ├── gitignore.ts
│   │   ├── selection.ts
│   │   ├── ignores.ts
│   │   ├── binaryDetection.ts
│   │   ├── fileWalker.ts
│   │   └── markdownBuilder.ts
│   ├── config/           # Configuration management
│   │   └── settings.ts
│   └── index.ts          # Extension entry point
├── package.json
├── tsconfig.json
└── README.md
```

## Installation

### Option 1: Install from VSIX (Recommended for Development)

1. **Package the extension**:
   ```bash
   cd vscode-extension
   npm install
   npm run compile
   npm install -g vsce
   vsce package
   ```

2. **Install in VS Code**:
   - Open VS Code
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
   - Type "Extensions: Install from VSIX..."
   - Select the generated `.vsix` file

### Option 2: Development Mode

1. Clone this repository
2. Open the `vscode-extension` folder in VS Code
3. Press `F5` to launch a new Extension Development Host window

## Development

### Building

```bash
cd vscode-extension
npm install
npm run compile
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Packaging for Distribution

```bash
# Install vsce if you haven't already
npm install -g vsce

# Package the extension
vsce package
```

## Troubleshooting

### Common Issues

1. **"No workspace folder found"**: Open a folder in VS Code before using the extension
2. **Empty export**: Check your ignore settings and .gitignore file
3. **Permission errors**: Ensure write permissions for the output file location

### Debug Mode

Enable VS Code's Developer Tools to see detailed console logs from the extension.

## Examples

### Export Specific Components
Select `src/components/` and `src/hooks/` → Exports all files in those folders (recursive)

### Export Mixed Selection
Select `src/components/Button.tsx`, `src/utils/`, and `README.md` → Exports Button.tsx + entire src/utils + README.md

### Custom Output Location
Setting: `markdownExport.outputFile = "docs/api-export.md"` → Creates file at: `<workspaceRoot>/docs/api-export.md`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Changelog

### v1.0.0
- Initial release with core functionality
- Multi-selection support
- Configurable ignore system with strict priority order
- Binary file handling with comprehensive defaults
- Clean architecture implementation
- Proper .gitignore parsing using ignore npm package
- Fixed all critical bugs from previous versions