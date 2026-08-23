import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import { createClassifier } from '../core/expansion';
import { resolvedConfiguration, withWorkspace } from './workspace';

// Direct tests for the classifier: the decision table `createClassifier`
// closes over, judged one candidate at a time with no Selection to walk.
// Parallel in shape to `binaryDetection.test.ts` — most rules cost no I/O;
// only the ones that must actually read a file (an unreadable path, a
// content sniff, and the fallthrough that reaches all the way to `embed`)
// touch a single real, minimal fixture built by the workspace helper.

test('a candidate that already carries a Stub reason from the walk is returned unchanged', async () => {
    const classify = createClassifier('/workspace', resolvedConfiguration());

    // This path would classify as binary by extension if it were judged
    // again. Carrying a reason already proves the walk's own verdict is
    // trusted as-is, never re-derived.
    const entry = await classify({
        absolutePath: '/workspace/assets/broken-link.png',
        reason: 'too-large'
    });

    assert.deepEqual(entry, {
        absolutePath: '/workspace/assets/broken-link.png',
        relativePath: 'assets/broken-link.png',
        classification: 'stub',
        reason: 'too-large'
    });
});

test('an exact path in the configured binaryFiles list is a Stub with reason binary', async () => {
    const classify = createClassifier('/workspace', resolvedConfiguration({ binaryFiles: ['data.custom'] }));

    const entry = await classify({ absolutePath: '/workspace/data.custom' });

    assert.deepEqual(entry, {
        absolutePath: '/workspace/data.custom',
        relativePath: 'data.custom',
        classification: 'stub',
        reason: 'binary'
    });
});

test('a file whose extension is on the configured binary list is a Stub with reason binary', async () => {
    const classify = createClassifier('/workspace', resolvedConfiguration());

    const entry = await classify({ absolutePath: '/workspace/assets/logo.png' });

    assert.deepEqual(entry, {
        absolutePath: '/workspace/assets/logo.png',
        relativePath: 'assets/logo.png',
        classification: 'stub',
        reason: 'binary'
    });
});

test('a candidate over the configured size threshold is a Stub with reason too-large', async () => {
    const classify = createClassifier('/workspace', resolvedConfiguration({ maxFileSizeBytes: 1024 }));

    const entry = await classify({ absolutePath: '/workspace/debug.log', sizeBytes: 2048 });

    assert.deepEqual(entry, {
        absolutePath: '/workspace/debug.log',
        relativePath: 'debug.log',
        classification: 'stub',
        reason: 'too-large'
    });
});

test('a candidate exactly at the size threshold is not too-large', async () => {
    await withWorkspace({ 'edge.txt': '' }, async root => {
        const classify = createClassifier(root, resolvedConfiguration({ maxFileSizeBytes: 1024 }));
        const absolutePath = path.join(root, 'edge.txt');

        // The classifier trusts the size the candidate already carries
        // rather than re-deriving it, so the real file can stay empty.
        const entry = await classify({ absolutePath, sizeBytes: 1024 });

        assert.deepEqual(entry, {
            absolutePath,
            relativePath: 'edge.txt',
            classification: 'embed'
        });
    });
});

test('a size threshold of zero means no threshold at all', async () => {
    await withWorkspace({ 'huge.txt': '' }, async root => {
        const classify = createClassifier(root, resolvedConfiguration({ maxFileSizeBytes: 0 }));
        const absolutePath = path.join(root, 'huge.txt');

        // A candidate size no real threshold would ever clear; zero must
        // still mean nothing stubs it for being too large.
        const entry = await classify({ absolutePath, sizeBytes: Number.MAX_SAFE_INTEGER });

        assert.deepEqual(entry, {
            absolutePath,
            relativePath: 'huge.txt',
            classification: 'embed'
        });
    });
});

test('content that sniffs as binary is a Stub with reason binary, regardless of extension', async () => {
    const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    await withWorkspace({ 'build/module.wasm': wasm }, async root => {
        const classify = createClassifier(root, resolvedConfiguration());
        const absolutePath = path.join(root, 'build/module.wasm');

        const entry = await classify({ absolutePath, sizeBytes: wasm.length });

        assert.deepEqual(entry, {
            absolutePath,
            relativePath: path.join('build', 'module.wasm'),
            classification: 'stub',
            reason: 'binary'
        });
    });
});

test('a path that cannot be stat-ed is a Stub with reason unreadable', async () => {
    await withWorkspace({}, async root => {
        const classify = createClassifier(root, resolvedConfiguration());
        const absolutePath = path.join(root, 'missing.bin');

        // No sizeBytes on the candidate and nothing at this path: the
        // classifier's own stat call is what fails here, not the walk's.
        const entry = await classify({ absolutePath });

        assert.deepEqual(entry, {
            absolutePath,
            relativePath: 'missing.bin',
            classification: 'stub',
            reason: 'unreadable'
        });
    });
});

test('a candidate that clears every check is classified embed', async () => {
    await withWorkspace({ 'src/index.ts': 'export const answer = 42;\n' }, async root => {
        const classify = createClassifier(root, resolvedConfiguration());
        const absolutePath = path.join(root, 'src/index.ts');

        const entry = await classify({ absolutePath });

        assert.deepEqual(entry, {
            absolutePath,
            relativePath: path.join('src', 'index.ts'),
            classification: 'embed'
        });
    });
});
