import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { countBacktickRuns, fenceOf } from '../core/export';
import { ExpansionEntry, StubReason } from '../core/expansion';
import { renderFileTree } from '../core/fileTree';

// Direct tests for renderFileTree: the shape of an Export's file tree,
// judged from hand-built ExpansionEntry arrays with nothing walked and
// nothing rendered around them. The interface was already the deep,
// pure kind — entries and an optional token-count map in, a string out —
// so this ticket opens no new seam and changes no production code; it only
// starts using the door that was already there. Parallel in shape to
// `binaryDetection.test.ts`: no workspace, no Expansion, no Export.
//
// The deletion test is what justifies writing these at all: delete
// renderFileTree and every fact below would have to be re-proven by
// walking a real Selection and rendering a whole document to reach it,
// at a much higher cost and a much lower locality — the workspace fixture,
// not the assertion, would carry the meaning. Calling the function
// directly is the leverage this ticket exists to spend.

function embedded(relativePath: string): ExpansionEntry {
    return { absolutePath: `/workspace/${relativePath}`, relativePath, classification: 'embed' };
}

function stub(relativePath: string, reason: StubReason): ExpansionEntry {
    return { absolutePath: `/workspace/${relativePath}`, relativePath, classification: 'stub', reason };
}

test('nested paths draw a tree with each level indented under its parent', () => {
    const tree = renderFileTree([
        embedded('a/b/c/d/leaf.ts'),
        embedded('a/b/other.ts'),
        embedded('a/top.ts')
    ]);

    assert.equal(tree, [
        '.',
        '└── a/',
        '    ├── b/',
        '    │   ├── c/',
        '    │   │   └── d/',
        '    │   │       └── leaf.ts',
        '    │   └── other.ts',
        '    └── top.ts',
        ''
    ].join('\n'));
});

test("a Stub's reason is annotated inline, and wins over any token count for the same path", () => {
    // secret.txt also has a token count in the map, to prove the Stub
    // branch never consults it — a Stub has no content and so nothing to
    // count, and the two annotations must never compete for the same slot.
    const tree = renderFileTree([
        stub('assets/logo.png', 'binary'),
        stub('logs/debug.log', 'too-large'),
        stub('secret.txt', 'unreadable')
    ], new Map([['secret.txt', 999]]));

    assert.equal(tree, [
        '.',
        '├── assets/',
        '│   └── logo.png  (omitted: binary)',
        '├── logs/',
        '│   └── debug.log  (omitted: too large)',
        '└── secret.txt  (omitted: unreadable)',
        ''
    ].join('\n'));
});

test('a token count is annotated inline, and zero is shown rather than treated as absent', () => {
    const tree = renderFileTree([
        embedded('notes.md'),
        embedded('empty.ts'),
        embedded('untouched.ts')
    ], new Map([['notes.md', 42], ['empty.ts', 0]]));

    assert.equal(tree, [
        '.',
        '├── notes.md  (~42 tokens)',
        // Zero is still a fact about the file, not an absence of one: it is
        // in the map, so it is shown, the same as any other embedded count.
        '├── empty.ts  (~0 tokens)',
        // Missing from the map entirely — never measured — so nothing is
        // claimed about it rather than a nought it did not earn.
        '└── untouched.ts',
        ''
    ].join('\n'));
});

test("a name carrying backticks widens the tree's own fence", () => {
    const tree = renderFileTree([embedded('a```b.ts')]);

    assert.equal(tree, '.\n└── a```b.ts\n');

    // renderFileTree hands the name back unescaped, so the tree text itself
    // now carries the same three-backtick run a file's content would. The
    // fence this ticket leaves untouched — countBacktickRuns and fenceOf,
    // exported for exactly this — has to widen past it, the same as it
    // would for a file's own content.
    const run = { current: 0, longest: 0 };
    countBacktickRuns(tree, run);
    assert.equal(fenceOf(run.longest), '`'.repeat(4));
});

test('a single entry with no nesting renders as one leaf under the root', () => {
    const tree = renderFileTree([embedded('notes.md')]);

    assert.equal(tree, '.\n└── notes.md\n');
});

test('an empty entry list renders an empty tree rather than throwing', () => {
    assert.equal(renderFileTree([]), '.\n');
});
