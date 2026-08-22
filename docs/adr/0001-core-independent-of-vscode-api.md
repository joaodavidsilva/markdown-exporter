# The core is independent of the VS Code API

Expansion, exclusion and markdown generation live in a core that never imports `vscode`.
The extension is a thin adapter over it: it collects the selection, calls the core, and
delivers the result to a destination.

This is **not** for portability. Other IDE platforms (JetBrains, Zed) were explicitly
ruled out of scope — the only targets are VS Code and its forks (Cursor, Windsurf,
VSCodium), which all run the same VSIX. Anyone reading the code will assume the adapter
layer exists to enable a future port, and will be wrong.

The reason is testability. We chose to test the core with fast tests over real temporary
directories, without launching an editor instance. That is only possible if no code path
under test touches the `vscode` API. The previous version could not be tested at all:
`shouldIgnoreFile` called `vscode.workspace.getConfiguration()` on every file visited,
which coupled the innermost loop of the walker to the editor.

## Consequences

- Configuration is read once, at the adapter boundary, and passed into the core as a plain
  value. The core never reaches out for settings.
- Filesystem access in the core is Node's `fs`, not `vscode.workspace.fs`.
- User-facing messages, progress reporting and clipboard access stay in the adapter.
- If a non-VS Code target is ever reconsidered, this ADR's premise changes but its
  conclusion does not.
