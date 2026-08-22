# Selection Markdown Exporter

A VS Code extension that turns a hand-picked set of files and folders into a single
markdown document, for pasting into an LLM, for documentation, or for sharing.

The defining idea is **curation**: the user chooses *what goes in*, interactively, in the
editor. Packing a whole repository is the degenerate case, not the main one.

## Language

### The core flow

**Selection**:
The set of files and folders the user picked in the explorer before invoking a command.
A selection is what the user *chose*, not what will end up in the export — exclusions are
applied afterwards.
_Avoid_: input, files, target

**Expansion**:
Walking a selection down to a flat list of concrete files, applying exclusions along the way.
_Avoid_: traversal, scan, crawl

**Export**:
The markdown document produced from an expanded selection. Used as a noun for the artifact;
"exporting" is the act of producing one.
_Avoid_: dump, bundle, pack, output file

**Destination**:
Where an export is delivered — a file in the workspace, or the clipboard. One export, one
destination, chosen by which command was invoked.
_Avoid_: output, sink, target

### What shapes an export

**Exclusion**:
A rule that removes a file from an expansion, so it appears nowhere in the export. Sources
are `.gitignore`, `.exportignore`, and user settings.
_Avoid_: filter, ignore rule, skip

**Stub**:
An entry that appears in the export with its path, but deliberately without its content —
because the file is binary, or too large. A stub is a decision to *mention and omit*, which
is different from an exclusion, where the file is never mentioned at all.
_Avoid_: placeholder, skipped file, binary

**Redaction**:
Masking a secret value inside a file's content while still embedding the rest of that file.
Distinct from a stub: the file is included, only the sensitive spans are replaced.
_Avoid_: sanitisation, scrubbing, filtering

**Outline**:
An export mode that embeds only the shape of each file — signatures, declarations, imports —
without the bodies. Used to fit a large selection into a context window.
_Avoid_: skeleton, summary, structure-only

### Reuse

**Profile**:
A named, saved selection that can be re-exported later without picking the files again.
_Avoid_: preset, template, saved search
