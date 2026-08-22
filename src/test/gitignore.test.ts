import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { createGitignoreFilter } from '../core/gitignore';
import { withWorkspace } from './workspace';

test('without a .gitignore nothing is excluded', async () => {
    await withWorkspace({ 'src/index.ts': '' }, async root => {
        const isExcluded = await createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'src/index.ts')), false);
    });
});

test('a file matching a root .gitignore rule is excluded', async () => {
    await withWorkspace({ '.gitignore': '*.log\n', 'debug.log': '' }, async root => {
        const isExcluded = await createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'debug.log')), true);
    });
});

test('a file matching no rule is not excluded', async () => {
    await withWorkspace({ '.gitignore': '*.log\n', 'src/index.ts': '' }, async root => {
        const isExcluded = await createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'src/index.ts')), false);
    });
});

test('a directory rule excludes everything beneath it', async () => {
    await withWorkspace({ '.gitignore': 'out/\n', 'out/core/paths.js': '' }, async root => {
        const isExcluded = await createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'out/core/paths.js')), true);
    });
});

test('a negated rule re-includes a file an earlier rule excluded', async () => {
    await withWorkspace({ '.gitignore': '*.log\n!keep.log\n', 'keep.log': '' }, async root => {
        const isExcluded = await createGitignoreFilter(root);
        assert.equal(isExcluded(path.join(root, 'keep.log')), false);
    });
});
