import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { expandSelection } from '../core/expansion';
import { resolvedConfiguration, withWorkspace } from './workspace';

function relativePaths(entries: { relativePath: string }[]): string[] {
    return entries.map(entry => entry.relativePath);
}

test('a picked file becomes one entry, at its path relative to the workspace root', async () => {
    await withWorkspace({ 'src/index.ts': 'export {};\n' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [path.join(root, 'src/index.ts')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('a picked file is classified as embedded', async () => {
    await withWorkspace({ 'src/index.ts': 'export {};\n' }, async root => {
        const [entry] = await expandSelection({
            selectionPaths: [path.join(root, 'src/index.ts')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.equal(entry.classification, 'embed');
    });
});

test('a picked folder expands to every file beneath it', async () => {
    await withWorkspace({
        'src/index.ts': '',
        'src/deep/nested/util.ts': '',
        'README.md': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [path.join(root, 'src')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [
            path.join('src', 'deep', 'nested', 'util.ts'),
            path.join('src', 'index.ts')
        ]);
    });
});

test('entries come back in the same order whatever order the Selection was picked in', async () => {
    const files = { 'a.ts': '', 'b.ts': '', 'c.ts': '' };
    const picked = ['c.ts', 'a.ts', 'b.ts'];

    await withWorkspace(files, async root => {
        const entries = await expandSelection({
            selectionPaths: picked.map(name => path.join(root, name)),
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), ['a.ts', 'b.ts', 'c.ts']);
    });
});

test('an empty Selection expands to no entries', async () => {
    await withWorkspace({ 'a.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(entries, []);
    });
});

test('a Selection path that no longer exists is skipped rather than failing the Expansion', async () => {
    await withWorkspace({ 'a.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [path.join(root, 'gone.ts'), path.join(root, 'a.ts')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), ['a.ts']);
    });
});

test('a file a .gitignore rule matches is excluded from the Expansion', async () => {
    await withWorkspace({
        '.gitignore': '*.log\n',
        'debug.log': '',
        'src/index.ts': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.equal(relativePaths(entries).includes('debug.log'), false);
        assert.equal(relativePaths(entries).includes(path.join('src', 'index.ts')), true);
    });
});

test('everything beneath a directory a .gitignore rule matches is excluded', async () => {
    await withWorkspace({
        '.gitignore': 'node_modules/\n',
        'node_modules/left-pad/index.js': '',
        'src/index.ts': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), ['.gitignore', path.join('src', 'index.ts')]);
    });
});

test('a file listed in additionalIgnore is excluded from the Expansion', async () => {
    await withWorkspace({ 'notes.md': '', 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration({ additionalIgnore: ['notes.md'] })
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('a previous Export at the configured output file is never part of a new one', async () => {
    await withWorkspace({ 'FULL_CODE.md': '# Project Code Export\n', 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('the file this Export writes to is never part of it', async () => {
    await withWorkspace({ 'FULL_CODE_2026-01-01_00-00-00.md': '', 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration(),
            exportFileName: 'FULL_CODE_2026-01-01_00-00-00.md'
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});
