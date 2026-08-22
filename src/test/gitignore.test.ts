import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createGitignoreFilter } from '../core/gitignore';

/**
 * Build a real workspace on disk, run against it, then tear it down. The code
 * under test reads the filesystem, so mocking it would test nothing.
 */
function withWorkspace(files: Record<string, string>, run: (root: string) => void): void {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-exporter-')));
    try {
        for (const [relativePath, content] of Object.entries(files)) {
            const absolutePath = path.join(root, relativePath);
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, content, 'utf8');
        }
        run(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('without a .gitignore nothing is excluded', () => {
    withWorkspace({ 'src/index.ts': '' }, root => {
        const isExcluded = createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'src/index.ts')), false);
    });
});

test('a file matching a root .gitignore rule is excluded', () => {
    withWorkspace({ '.gitignore': '*.log\n', 'debug.log': '' }, root => {
        const isExcluded = createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'debug.log')), true);
    });
});

test('a file matching no rule is not excluded', () => {
    withWorkspace({ '.gitignore': '*.log\n', 'src/index.ts': '' }, root => {
        const isExcluded = createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'src/index.ts')), false);
    });
});

test('a directory rule excludes everything beneath it', () => {
    withWorkspace({ '.gitignore': 'out/\n', 'out/core/paths.js': '' }, root => {
        const isExcluded = createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'out/core/paths.js')), true);
    });
});

test('a negated rule re-includes a file an earlier rule excluded', () => {
    withWorkspace({ '.gitignore': '*.log\n!keep.log\n', 'keep.log': '' }, root => {
        const isExcluded = createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'keep.log')), false);
    });
});
