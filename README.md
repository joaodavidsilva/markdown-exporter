# Selection Markdown Exporter

A VS Code extension that exports selected files and folders to a single markdown file, perfect for AI analysis and documentation generation.

## Features

- **Multi-selection support**: Export single files, multiple files, folders, or mixed selections
- **Two destinations**: Copy the export to the clipboard, or write it to a file
- **Automatic timestamping**: Output files automatically get timestamps to prevent overwrites
- **Smart ignore system**: Respects nested .gitignore files, an .exportignore of your own, and glob patterns from settings, in a strict priority order
- **Binary file handling**: Automatically detects and excludes binary files with placeholders
- **Clean architecture**: Well-organized codebase with proper separation of concerns
- **Configurable**: Extensive configuration options for all aspects of export
- **Cross-platform**: Works on macOS, Windows, and Linux

## Usage

Two commands, differing only in where the export is delivered:

- **Copy as Markdown** puts the export on the clipboard and writes no file.
  Use it when the export is going to be pasted somewhere, which is most of
  the time.
- **Export to Markdown** writes the export to a timestamped file in the
  workspace root. Use it when the export is to be archived or shared.

Both produce the same document, and the notification afterwards says which
one it went to.

### Context Menu (Recommended)

1. **Select files/folders** in the Explorer
2. **Right-click** and select "Copy as Markdown" or "Export to Markdown"
3. The extension exports your selection to the clipboard or to a file

Both entries sit in their own section of the context menu rather than at the
top of it: an export is not a navigation action, and two commands crowding
the top would be worse than the one that used to.

### Command Palette

1. Open Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type "Copy as Markdown" or "Export to Markdown"
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
  - Used by **Export to Markdown** only; **Copy as Markdown** writes no file
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

An ignored file appears nowhere in the export: the export gives no sign it
existed. That is different from a stub — see **Stub Settings** below.

#### Priority Order (Strict)

In increasing precedence — the last source with something to say about a path
decides:

1. Every `.gitignore` from the workspace root down to the file's own directory,
   with git's own semantics for nesting and negation: a `.gitignore` governs
   its directory and everything beneath it, its patterns are relative to where
   it sits, and the deepest one with an opinion wins
2. `.exportignore` at the workspace root, in the same syntax
3. `markdownExport.additionalIgnore`

Two rules stand outside that order, because they are the tool's own rather than
yours. They cannot be configured off, and — unlike everything above — picking
the path in the explorer does not override them:

- `.git/` is never walked
- an export this extension wrote is never inside a later one

#### Explicit picks win

A file you picked in the explorer is exported even when an ignore rule matches
it: picking it is what you said, and a rule is only what you said by default.

The override stops at what you picked. A file the walk discovers *inside* a
folder you picked is still judged normally — otherwise picking the project root
would drag in everything the rules exist to keep out.

#### `.exportignore`

Put an `.exportignore` in the repository root for ignore rules that belong to
exporting rather than to git. Same syntax as a `.gitignore`, negations
included, and it is read after the `.gitignore` files, so it can both take out
what git kept and keep what git took out.

```gitignore
# Exclude from exports, though git tracks them
**/*.snap
docs/generated/

# Export this one, though .gitignore excludes it
!fixtures/example.log
```

#### Never exporting a previous export

**Export to Markdown** writes a timestamped file, so excluding the configured
`outputFile` name alone left every export it had ever written free to appear in
the next one — and each run made the next one bigger.

A file in the workspace root is recognised as a previous export when its name
is exactly the shape the extension writes: the configured base name, a
timestamp, the configured extension. That is the narrowest rule that catches
them. Your own `FULL_CODE_notes.md`, or an `archive/FULL_CODE_2026-08-22_10-00-00.md`
outside the workspace root, is a file you wrote and stays in your export.

#### Settings

- `markdownExport.additionalIgnore`: Array of paths and glob patterns to ignore,
  in `.gitignore` syntax. An entry with no glob character in it is an exact path
  relative to the workspace root — exactly what it meant before patterns were
  accepted — so upgrading does not change what your exports contain.
  ```json
  "markdownExport.additionalIgnore": [
    "node_modules",
    "dist",
    "build",
    ".env",
    "**/*.snap"
  ]
  ```

### Stub Settings

A stub is a file the export mentions at its path, with its content
deliberately omitted and the reason stated. Unlike an ignored file, you can
still see that it is there. There are three reasons a file becomes a stub.

**Binary.** Either its extension is on the configured list, or a null byte
appears in its first 8 KB. The content check is what catches the extensions
nobody listed — `.wasm`, `.pyc`, `.class`, `.db` — which would otherwise be
decoded as UTF-8 and embedded as noise.

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

**Too large.** Over the configured byte threshold, so that one large log file
cannot consume the whole export.

- `markdownExport.maxFileSizeBytes`: Size above which a file becomes a stub
  (default: `1048576`, one megabyte). Zero means no limit.
  ```json
  "markdownExport.maxFileSizeBytes": 1048576
  ```

**Unreadable.** The file could not be read — a permission error, or a symlink
pointing nowhere. One unreadable file no longer costs you the whole export. A
directory that cannot be read is stubbed the same way, so the rest of the
selection is still exported.

Symlinked directories are never followed, so a circular link terminates
instead of hanging the export.

### Default Binary Extensions

The extension includes these default binary extensions:
- **Images**: png, jpg, jpeg, gif, bmp, webp, tif, tiff, ico, avif, heic, heif
- **Videos**: mp4, mov, avi, mkv, webm, mpeg, mpg, 3gp, ogv
- **Documents**: pdf, doc, docx, xls, xlsx, ppt, pptx
- **Archives**: zip, rar, 7z, gz, tar
- **Executables**: exe, dll, so, dylib

## Output Format

The generated markdown file includes:

1. **File tree**: the shape of the export, drawn from exactly the entries it
   contains — stubs included, marked with the reason their content is absent
2. **File sections**: Each file with proper syntax highlighting
3. **Stubs**: Files mentioned at their path with their content omitted and the reason stated

The language hint on each block is chosen by file name first and extension
second, so `Dockerfile`, `Makefile`, `Gemfile` and `.gitignore` are recognised
even though they have no extension. An extension the map does not know produces
no hint rather than a wrong one.

### Example Output

````markdown
# Project Code Export

## File tree

```
.
├── Dockerfile
├── assets/
│   └── logo.png  (omitted: binary)
└── src/
    └── index.ts
```

---

## Dockerfile

```dockerfile
FROM node:20
```

---

## src/index.ts

```typescript
export const answer = 42;
```

---

## assets/logo.png

> **Content omitted** — this file is binary.

---
````

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