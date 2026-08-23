import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { createGitignoreChain } from '../core/gitignore';
import { withWorkspace } from './workspace';

/**
 * git's verdict for a file, with the chain first told about every directory
 * from the workspace root down to the one the file sits in — which is what the
 * walk does as it goes.
 */
async function verdictFor(root: string, relativePath: string): Promise<string | undefined> {
    const chain = createGitignoreChain(root);
    const absolutePath = path.join(root, relativePath);

    let directory = root;
    for (const segment of path.dirname(relativePath).split(path.sep)) {
        await chain.enter(directory);
        if (segment === '.') {
            break;
        }
        directory = path.join(directory, segment);
    }
    await chain.enter(directory);

    return chain.decide(absolutePath);
}

test('without a .gitignore nothing is excluded', async () => {
    await withWorkspace({ 'src/index.ts': '' }, async root => {
        assert.notEqual(await verdictFor(root, 'src/index.ts'), 'excluded');
    });
});

test('a file matching a root .gitignore rule is excluded', async () => {
    await withWorkspace({ '.gitignore': '*.log\n', 'debug.log': '' }, async root => {
        assert.equal(await verdictFor(root, 'debug.log'), 'excluded');
    });
});

test('a file matching no rule is not excluded', async () => {
    await withWorkspace({ '.gitignore': '*.log\n', 'src/index.ts': '' }, async root => {
        assert.notEqual(await verdictFor(root, 'src/index.ts'), 'excluded');
    });
});

test('a directory rule excludes everything beneath it', async () => {
    await withWorkspace({ '.gitignore': 'out/\n', 'out/core/paths.js': '' }, async root => {
        assert.equal(await verdictFor(root, 'out/core/paths.js'), 'excluded');
    });
});

test('a negated rule re-includes a file an earlier rule excluded', async () => {
    await withWorkspace({ '.gitignore': '*.log\n!keep.log\n', 'keep.log': '' }, async root => {
        assert.notEqual(await verdictFor(root, 'keep.log'), 'excluded');
    });
});

test('a root rule reaches into a subdirectory', async () => {
    await withWorkspace({ '.gitignore': '*.log\n', 'src/debug.log': '' }, async root => {
        assert.equal(await verdictFor(root, 'src/debug.log'), 'excluded');
    });
});

test('a nested .gitignore excludes a file the root one says nothing about', async () => {
    await withWorkspace({
        '.gitignore': '*.log\n',
        'src/.gitignore': '*.snap\n',
        'src/component.snap': ''
    }, async root => {
        assert.equal(await verdictFor(root, 'src/component.snap'), 'excluded');
    });
});

test('a nested rule governs only the directory it sits in', async () => {
    await withWorkspace({
        'src/.gitignore': '*.snap\n',
        'test/component.snap': ''
    }, async root => {
        assert.notEqual(await verdictFor(root, 'test/component.snap'), 'excluded');
    });
});

test('a nested negation re-includes a file the root .gitignore excluded', async () => {
    await withWorkspace({
        '.gitignore': '*.log\n',
        'src/.gitignore': '!keep.log\n',
        'src/keep.log': '',
        'other.log': ''
    }, async root => {
        assert.equal(await verdictFor(root, 'src/keep.log'), 'included');
        assert.equal(await verdictFor(root, 'other.log'), 'excluded');
    });
});

test("a nested .gitignore's patterns are relative to its own directory", async () => {
    await withWorkspace({
        'src/.gitignore': '/generated.ts\n',
        'src/generated.ts': '',
        'src/deep/generated.ts': ''
    }, async root => {
        assert.equal(await verdictFor(root, 'src/generated.ts'), 'excluded');
        assert.notEqual(await verdictFor(root, 'src/deep/generated.ts'), 'excluded');
    });
});

test('a directory the chain was never told about has no verdict of its own', async () => {
    await withWorkspace({ 'src/.gitignore': '*.snap\n', 'src/a.snap': '' }, async root => {
        const chain = createGitignoreChain(root);
        await chain.enter(root);
        assert.equal(chain.decide(path.join(root, 'src/a.snap')), undefined);
    });
});
