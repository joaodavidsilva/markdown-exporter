# Selection Markdown Exporter

<p align="center">
  <img src="./assets/readme/hero-dark.png#gh-dark-mode-only" width="100%" alt="Selection Markdown Exporter: Curate files and folders in the VS Code Explorer into one token-counted, secret-redacted Markdown document">
  <img src="./assets/readme/hero-light.png#gh-light-mode-only" width="100%" alt="Selection Markdown Exporter: Curate files and folders in the VS Code Explorer into one token-counted, secret-redacted Markdown document">
</p>

Turn a hand-picked **Selection** of files and folders in the VS Code Explorer (or Cursor, Windsurf, and VSCodium) into a single, structured **Export** in Markdown — ready to paste into an LLM context window, attach to an issue, or archive as documentation.

Packing a whole repository is the fallback, not the main workflow: **curation happens interactively in the editor**, with per-file `~o200k_base` token counts, 3-tier ignore precedence, explicit stubs for binary or oversized files, and best-effort inline secret redaction.

---

## Proof: What an Export Looks Like

Every run produces the same self-contained Markdown document whether delivered to the clipboard or written to a timestamped file:

````markdown
# Project Code Export

## File tree

```
.
├── .env  (~18 tokens)
├── Dockerfile  (~6 tokens)
├── assets/
│   └── logo.png  (omitted: binary)
└── src/
    └── index.ts  (~42 tokens)
```

Token counts are approximate: they are taken from the o200k_base vocabulary, and other model families tokenize differently.

---

## .env

```dotenv
DATABASE_URL=postgres://app:[REDACTED: database password]@db.internal:5432/prod
OPENAI_API_KEY=[REDACTED: OpenAI API key]
```

---

## Dockerfile

```dockerfile
FROM node:20
```

---

## assets/logo.png

> **Content omitted** — this file is binary.

---

## src/index.ts

```typescript
export const answer = 42;
```

---
````

When the Export finishes, VS Code shows a single notification naming the destination, the approximate total token cost, and how many secret-shaped spans were redacted:

```text
Markdown Exporter: Export copied to the clipboard — ~1,240 tokens (approximate), 2 redactions
```

If the total exceeds `markdownExport.tokenWarningThreshold` (default: `128,000` tokens), the notification switches to a warning so an oversized selection is caught before you paste it.

---

## Quick Start

Two commands share the exact same expansion, redaction, and rendering pipeline, differing only in their **Destination**:

- **Copy as Markdown** (`markdownExport.copy`) — puts the Export on the clipboard and writes no file. Use this when pasting directly into a chat or prompt.
- **Export to Markdown** (`markdownExport.export`) — writes a timestamped file (`FULL_CODE_YYYY-MM-DD_HH-mm-ss.md`) into the workspace root. Use this when archiving or sharing a snapshot.

### 1. From the Explorer Context Menu (Recommended)

1. **Select files and/or folders** in the VS Code Explorer (`Cmd`/`Ctrl`-click or `Shift`-click for multi-selection).
2. **Right-click** the selection and choose **Copy as Markdown** or **Export to Markdown** (grouped in their own `markdownExport` menu section so they do not crowd navigation actions).

### 2. From the Command Palette

1. Open the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux).
2. Run **Markdown Export: Copy as Markdown** or **Markdown Export: Export to Markdown**.

### Selection Behavior

- **Single or multiple files**: Exports only the picked files.
- **Single or multiple folders**: Walks each picked folder recursively, applying exclusion rules along the way.
- **Mixed selection**: Exports the union of all picked files and folders without duplicates.
- **No selection (Command Palette)**: Exports the entire workspace root.

---

## How It Works

<p align="center">
  <img src="./assets/readme/workflow-dark.svg#gh-dark-mode-only" width="100%" alt="Core Export Pipeline: 1. Selection in Explorer, 2. Expansion and classification, 3. Two-pass streaming Export with redaction and token counting, 4. Delivery to Clipboard or File">
  <img src="./assets/readme/workflow-light.svg#gh-light-mode-only" width="100%" alt="Core Export Pipeline: 1. Selection in Explorer, 2. Expansion and classification, 3. Two-pass streaming Export with redaction and token counting, 4. Delivery to Clipboard or File">
</p>

1. **Selection**: Captures the paths you picked in the Explorer.
2. **Expansion**: Walks directories down to a flat, ordered list of entries, dropping excluded paths and classifying remaining entries as either **Embedded** text files or **Stubs**.
3. **Export**: Streams the Markdown document in two passes over the files (never holding the whole rendered document in memory at once):
   - **Pass 1 (Measure)**: Applies secret redaction first, measures the longest backtick run so code fences never break, and counts tokens using `o200k_base`.
   - **Pass 2 (Stream)**: Writes the annotated `## File tree`, language-fenced file sections (matched by filename first — `Dockerfile`, `Makefile`, `Gemfile`, `.gitignore` — then extension), and stub notices.
4. **Destination**: Delivers the stream to the clipboard or a timestamped file. Cancelling from the progress toast aborts cleanly between chunks and leaves no partial file behind.

---

## What Shapes an Export: Exclusion vs. Stub vs. Redaction

<p align="center">
  <img src="./assets/readme/rules-dark.svg#gh-dark-mode-only" width="100%" alt="Comparison of Exclusion (silent omission), Stub (path kept, content omitted with reason), and Redaction (file embedded, secrets masked inline)">
  <img src="./assets/readme/rules-light.svg#gh-light-mode-only" width="100%" alt="Comparison of Exclusion (silent omission), Stub (path kept, content omitted with reason), and Redaction (file embedded, secrets masked inline)">
</p>

### 1. Exclusion (Ignore Rules)

An excluded file appears **nowhere** in the Export — neither in the file tree nor in the body.

#### Strict Priority Order (Last Match Wins)

Sources are evaluated in increasing precedence so later layers can both exclude what earlier layers kept and re-include (`!pattern`) what earlier layers ignored:

1. **Nested `.gitignore` files** from the workspace root down to the file's directory, following Git's own scoping and negation semantics.
2. **`.exportignore`** at the workspace root (same `.gitignore` syntax, evaluated after all `.gitignore` files).
3. **`markdownExport.additionalIgnore`** in VS Code settings.

```gitignore
# .exportignore — exclude from exports even though git tracks them
**/*.snap
docs/generated/

# Re-include a fixture even though .gitignore excludes it
!fixtures/example.log
```

#### Hard Rules & Explicit Picks

- **Unconditional exclusions**: `.git/` and previous timestamped exports written by this extension (`<basename>_YYYY-MM-DD_HH-mm-ss.<ext>` in the workspace root) are never walked or included, preventing self-inclusion across runs.
- **Explicit file picks win**: Picking a specific file in the Explorer exports it even if an ignore rule matches it. Picking a folder still filters the files discovered *inside* that folder normally.

---

### 2. Stubs (Mention and Omit)

A **Stub** lists the file at its path in `## File tree` and adds a section with a blockquote explaining why its content was omitted. A file becomes a Stub for one of three reasons:

- **Binary (`(omitted: binary)`)**: Its path is in `markdownExport.binaryFiles`, its extension is in `markdownExport.binaryFileExtensions`, or a null byte (`\0`) appears in its first 8 KB (catching unlisted binaries like `.wasm`, `.pyc`, `.class`, or `.sqlite`).
- **Too large (`(omitted: too large)`)**: Its size exceeds `markdownExport.maxFileSizeBytes` (default `1,048,576` bytes / 1 MB), preventing a single log or dump from consuming your context window.
- **Unreadable (`(omitted: unreadable)`)**: The file or directory could not be read due to permissions or a broken symlink. Symlinked directories are never followed, so circular links terminate safely.

---

### 3. Redaction (Inline Secret Masking)

**Redaction** embeds the file while replacing sensitive spans inside it with an explicit `[REDACTED: <what>]` marker before token counting and rendering.

- **Whole-file `.env` masking**: Any file named `.env` or `.env.<variant>` (`.env.local`, `.env.production`, `.env.example`, etc.) keeps its `KEY=` names and comments while masking every assigned value (`export KEY=value` and quoted values included).
- **Pattern matching across all embedded files**: Recognisable credential formats are masked wherever they appear:

| Credential Shape | Replacement Marker |
| --- | --- |
| AWS access key (`AKIA…`, `ASIA…`) | `[REDACTED: AWS access key]` |
| GitHub token (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_…`) | `[REDACTED: GitHub token]` |
| Stripe key (`sk_live_`, `sk_test_`, `pk_live_`, `pk_test_`, `rk_live_`, `rk_test_`) | `[REDACTED: Stripe key]` |
| OpenAI API key (`sk-…`) | `[REDACTED: OpenAI API key]` |
| Anthropic API key (`sk-ant-…`) | `[REDACTED: Anthropic API key]` |
| JSON Web Token (`eyJ…`.`…`.`…`) | `[REDACTED: JWT]` |
| Database URL password (`postgres://`, `mysql://`, `mongodb://`, `redis://`, `amqp://`, etc.) | `[REDACTED: database password]` (scheme, user, and host remain visible) |

#### Redaction Is Best-Effort, Not a Guarantee

Redaction catches the `.env` naming convention and the fixed credential prefixes listed above. Credentials in unlisted formats, secrets without a recognisable prefix, or values split across lines pass through unredacted. Treat Redaction as a safety net for common cases, not a substitute for reviewing your selection before pasting it externally.

---

## Configuration Reference

Configure under `markdownExport.*` in VS Code Settings (`settings.json`):

| Setting | Default | Description |
| --- | --- | --- |
| `markdownExport.outputFile` | `"FULL_CODE.md"` | Base filename (relative to workspace root) used by **Export to Markdown**. Always receives a `_YYYY-MM-DD_HH-mm-ss` suffix before the extension. |
| `markdownExport.additionalIgnore` | `[]` | Array of paths or `.gitignore`-style globs (e.g. `"**/*.snap"`). Highest ignore precedence. |
| `markdownExport.maxFileSizeBytes` | `1048576` | Byte limit (1 MB) above which a file becomes a Stub. Set to `0` for no size limit. |
| `markdownExport.tokenWarningThreshold` | `128000` | Approximate `o200k_base` token count above which the completion toast warns. Set to `0` to disable warnings. |
| `markdownExport.redactionEnabled` | `true` | Mask `.env*` values and recognisable secret patterns. Set to `false` when exporting test fixtures with intentional fake keys. |
| `markdownExport.binaryFiles` | `[]` | Exact workspace-relative file paths (e.g. `"data/dev.sqlite"`) to stub as binary. |
| `markdownExport.binaryFileExtensions` | Images, video, docs, archives, binaries | File extensions (without dots) treated as binary Stubs. |

<details>
<summary><strong>Example <code>settings.json</code> and Default Binary Extensions</strong></summary>

```json
{
  "markdownExport.outputFile": "FULL_CODE.md",
  "markdownExport.additionalIgnore": [
    "node_modules",
    "dist",
    "**/*.snap"
  ],
  "markdownExport.maxFileSizeBytes": 1048576,
  "markdownExport.tokenWarningThreshold": 128000,
  "markdownExport.redactionEnabled": true,
  "markdownExport.binaryFiles": [
    "assets/logo.png",
    "data/database.sqlite"
  ]
}
```

**Default `binaryFileExtensions`:**
- **Images**: `png`, `jpg`, `jpeg`, `gif`, `bmp`, `webp`, `tif`, `tiff`, `ico`, `avif`, `heic`, `heif`
- **Videos**: `mp4`, `mov`, `avi`, `mkv`, `webm`, `mpeg`, `mpg`, `3gp`, `ogv`
- **Documents**: `pdf`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`
- **Archives**: `zip`, `rar`, `7z`, `gz`, `tar`
- **Executables & Libraries**: `exe`, `dll`, `so`, `dylib`

</details>

---

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
- Proper `.gitignore` parsing using `ignore` npm package
- Fixed all critical bugs from previous versions
