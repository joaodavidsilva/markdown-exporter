import * as assert from 'node:assert/strict';
import { chmod, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';
import { ExportCancelled } from '../core/cancellation';
import { ResolvedConfiguration } from '../core/configuration';
import { createBufferedDestination, ExportDestination, openFileDestination } from '../core/destinations';
import { createExport } from '../core/export';
import { expandSelection, ExpansionEntry, StubReason } from '../core/expansion';
import { resolvedConfiguration, withWorkspace } from './workspace';

function embedded(root: string, relativePath: string): ExpansionEntry {
    return {
        absolutePath: path.join(root, relativePath),
        relativePath,
        classification: 'embed'
    };
}

function stub(root: string, relativePath: string, reason: StubReason): ExpansionEntry {
    return {
        absolutePath: path.join(root, relativePath),
        relativePath,
        classification: 'stub',
        reason
    };
}

async function renderToText(
    entries: ExpansionEntry[],
    configuration: ResolvedConfiguration = resolvedConfiguration()
): Promise<string> {
    const destination = createBufferedDestination();
    await createExport({ entries, configuration, destination });
    return destination.text();
}

/** The tree drawn at the head of an Export, without its fence. */
function treeOf(markdown: string): string {
    const match = /^## File tree\n\n(`{3,})\n([\s\S]*?)\n\1\n/m.exec(markdown);
    if (!match) {
        assert.fail('the Export has no file tree');
    }
    return match[2];
}

/**
 * The body of one entry's section: what follows its heading, up to the rule
 * that ends it. An Export now opens with a fenced file tree, so a claim about
 * one entry has to be made against that entry rather than the whole document.
 */
function sectionFor(markdown: string, relativePath: string): string {
    const heading = `\n## ${relativePath}\n\n`;
    const start = markdown.indexOf(heading);
    assert.notEqual(start, -1, `no section for ${relativePath}`);

    const body = markdown.slice(start + heading.length);
    const end = body.indexOf('\n---\n');
    return end === -1 ? body : body.slice(0, end);
}

test('every entry gets a heading at its path', async () => {
    await withWorkspace({ 'src/index.ts': 'export {};\n', 'README.md': '# Hi\n' }, async root => {
        const markdown = await renderToText([
            embedded(root, 'README.md'),
            embedded(root, path.join('src', 'index.ts'))
        ]);

        assert.equal(markdown.includes('\n## README.md\n'), true);
        assert.equal(markdown.includes(`\n## ${path.join('src', 'index.ts')}\n`), true);
    });
});

test('the Export opens with a file tree of exactly the entries it contains', async () => {
    await withWorkspace({
        'README.md': '# Hi\n',
        'src/index.ts': 'export {};\n',
        'src/util.ts': 'export {};\n',
        'left-out.ts': 'export {};\n'
    }, async root => {
        const markdown = await renderToText([
            embedded(root, 'README.md'),
            embedded(root, path.join('src', 'index.ts')),
            embedded(root, path.join('src', 'util.ts'))
        ]);

        assert.equal(treeOf(markdown), [
            '.',
            '├── README.md  (~3 tokens)',
            '└── src/',
            '    ├── index.ts  (~2 tokens)',
            '    └── util.ts  (~2 tokens)'
        ].join('\n'));

        // A file on disk that is not an entry is nowhere in the Export.
        assert.equal(markdown.includes('left-out.ts'), false);
        // And the tree is read before any of the code it describes.
        assert.equal(markdown.indexOf('## File tree') < markdown.indexOf('## README.md'), true);
    });
});

test('the tree draws nesting to whatever depth the Selection reaches', async () => {
    await withWorkspace({
        'a/b/c/d/leaf.ts': 'export {};\n',
        'a/b/other.ts': 'export {};\n',
        'a/top.ts': 'export {};\n'
    }, async root => {
        const markdown = await renderToText([
            embedded(root, path.join('a', 'b', 'c', 'd', 'leaf.ts')),
            embedded(root, path.join('a', 'b', 'other.ts')),
            embedded(root, path.join('a', 'top.ts'))
        ]);

        assert.equal(treeOf(markdown), [
            '.',
            '└── a/',
            '    ├── b/',
            '    │   ├── c/',
            '    │   │   └── d/',
            '    │   │       └── leaf.ts  (~2 tokens)',
            '    │   └── other.ts  (~2 tokens)',
            '    └── top.ts  (~2 tokens)'
        ].join('\n'));
    });
});

test('a Stub stands in the tree with the reason its content is absent', async () => {
    await withWorkspace({ 'src/index.ts': 'export {};\n' }, async root => {
        const markdown = await renderToText([
            embedded(root, path.join('src', 'index.ts')),
            stub(root, path.join('assets', 'logo.png'), 'binary'),
            stub(root, path.join('logs', 'debug.log'), 'too-large'),
            stub(root, 'secret.txt', 'unreadable')
        ]);

        assert.equal(treeOf(markdown), [
            '.',
            '├── src/',
            '│   └── index.ts  (~2 tokens)',
            '├── assets/',
            '│   └── logo.png  (omitted: binary)',
            '├── logs/',
            '│   └── debug.log  (omitted: too large)',
            '└── secret.txt  (omitted: unreadable)'
        ].join('\n'));

        // A Stub has no content and so nothing to count. The slot a token
        // count would sit in is the same one its reason already fills, and
        // the two never appear together on one line.
        assert.equal(/omitted:[^\n]*tokens/.test(markdown), false);
        assert.equal(/tokens\)[^\n]*omitted:/.test(markdown), false);
    });
});

test('an embedded file too small to have content is still annotated, at zero rather than omitted', async () => {
    await withWorkspace({ 'empty.ts': '' }, async root => {
        const markdown = await renderToText([embedded(root, 'empty.ts')]);

        // Zero tokens is still a fact about the file, not an absence of one —
        // an empty file is embedded, not a Stub, so it earns a count like any
        // other embedded file rather than the Stub vocabulary.
        assert.equal(treeOf(markdown), '.\n└── empty.ts  (~0 tokens)');
    });
});

test('unicode content is counted by the real vocabulary, not a character heuristic', async () => {
    // Portuguese, an em dash, an emoji and CJK together: the kind of mixed
    // content a character-per-token heuristic gets wrong in more than one
    // direction at once. The expected count comes from the same o200k_base
    // vocabulary the implementation uses, so this asserts the real tokenizer
    // ran rather than asserting a coincidence.
    const content = 'ação — ✅ 世界 🌍\n'.repeat(50);

    await withWorkspace({ 'unicode.md': content }, async root => {
        const markdown = await renderToText([embedded(root, 'unicode.md')]);

        assert.equal(treeOf(markdown), '.\n└── unicode.md  (~350 tokens)');
        // A characters/4 heuristic would have guessed a very different
        // number here (187): the multi-byte content is what tells them apart.
        assert.notEqual(350, Math.round(content.length / 4));
    });
});

test('a Selection of a single file still opens with its tree', async () => {
    await withWorkspace({ 'notes.md': 'text\n' }, async root => {
        const markdown = await renderToText([embedded(root, 'notes.md')]);

        assert.equal(treeOf(markdown), '.\n└── notes.md  (~2 tokens)');
    });
});

test('an empty Expansion draws a tree with nothing under its root', async () => {
    const markdown = await renderToText([]);

    assert.equal(treeOf(markdown), '.');
});

test('names outside ASCII reach the tree intact', async () => {
    await withWorkspace({
        'documentação/índice.md': 'texto\n',
        'ficheiros/日本語.txt': 'text\n',
        'emoji/🚀.md': 'text\n'
    }, async root => {
        const markdown = await renderToText([
            embedded(root, path.join('documentação', 'índice.md')),
            embedded(root, path.join('ficheiros', '日本語.txt')),
            embedded(root, path.join('emoji', '🚀.md'))
        ]);

        assert.equal(treeOf(markdown), [
            '.',
            '├── documentação/',
            '│   └── índice.md  (~2 tokens)',
            '├── ficheiros/',
            '│   └── 日本語.txt  (~2 tokens)',
            '└── emoji/',
            '    └── 🚀.md  (~2 tokens)'
        ].join('\n'));
    });
});

test('a name carrying backticks widens the tree fence rather than breaking it', async () => {
    await withWorkspace({ 'a```b.ts': 'export {};\n' }, async root => {
        const markdown = await renderToText([embedded(root, 'a```b.ts')]);

        assert.equal(treeOf(markdown), '.\n└── a```b.ts  (~2 tokens)');
        assert.equal(markdown.includes('## File tree\n\n````\n'), true);
    });
});

test('the index with its broken anchors is gone', async () => {
    await withWorkspace({ 'README.md': '# Hi\n', 'src/index.ts': 'export {};\n' }, async root => {
        const markdown = await renderToText([
            embedded(root, 'README.md'),
            embedded(root, path.join('src', 'index.ts'))
        ]);

        assert.equal(markdown.includes('## Index'), false);
        // No link of any kind survives, so no dead anchor can survive either.
        assert.equal(/\]\(#/.test(markdown), false);
    });
});

test('the tree of a real Expansion names exactly the entries the Export carries', async () => {
    const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    await withWorkspace({
        '.gitignore': '*.log\n',
        'README.md': '# Hi\n',
        'build/module.wasm': wasm,
        'logs/debug.log': 'noise\n',
        'src/deep/util.ts': 'export {};\n',
        'src/index.ts': 'export {};\n'
    }, async root => {
        const configuration = resolvedConfiguration();
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration
        });

        const destination = createBufferedDestination();
        await createExport({ entries, configuration, destination });

        const leaves = treeOf(destination.text())
            .split('\n')
            .slice(1)
            .map(line => line.replace(/^[^\p{L}\p{N}._]*/u, '').replace(/ {2}\((omitted: |~).*\)$/, ''))
            .filter(label => !label.endsWith('/'));

        assert.deepEqual(
            leaves.sort(),
            entries.map(entry => path.basename(entry.relativePath)).sort()
        );
        // The Exclusion is absent from the tree; the Stub is present in it.
        assert.equal(destination.text().includes('debug.log'), false);
        assert.equal(leaves.includes('module.wasm'), true);
    });
});

test('a file is embedded inside a fence carrying the language hint for its extension', async () => {
    await withWorkspace({ 'src/index.ts': 'const answer = 42;\n' }, async root => {
        const markdown = await renderToText([embedded(root, path.join('src', 'index.ts'))]);

        // The closing fence follows the content directly: the file's own
        // trailing newline is the one that puts the fence on its own line.
        assert.equal(markdown.includes('```typescript\nconst answer = 42;\n```'), true);
    });
});

test('a file whose content does not end in a newline still closes on its own line', async () => {
    await withWorkspace({ 'partial.ts': 'const answer = 42;' }, async root => {
        const markdown = await renderToText([embedded(root, 'partial.ts')]);

        assert.equal(markdown.includes('```typescript\nconst answer = 42;\n```'), true);
    });
});

test('an empty file closes its fence immediately', async () => {
    await withWorkspace({ 'empty.ts': '' }, async root => {
        const markdown = await renderToText([embedded(root, 'empty.ts')]);

        assert.equal(markdown.includes('```typescript\n```'), true);
    });
});

test('a file whose extension has no known language gets a fence with no hint', async () => {
    await withWorkspace({ 'notes.zzz': 'plain\n' }, async root => {
        const markdown = await renderToText([embedded(root, 'notes.zzz')]);

        assert.equal(markdown.includes('```\nplain\n'), true);
        assert.equal(/```zzz/.test(markdown), false);
    });
});

test('extensions the map used to miss now carry their language hint', async () => {
    const cases: [string, string][] = [
        ['bundle.mjs', 'javascript'],
        ['types.mts', 'typescript'],
        ['main.dart', 'dart'],
        ['app.lua', 'lua'],
        ['worker.ex', 'elixir'],
        ['Deploy.tf', 'hcl'],
        ['schema.graphql', 'graphql'],
        ['service.proto', 'protobuf'],
        ['build.gradle', 'groovy'],
        ['flake.nix', 'nix'],
        ['fix.patch', 'diff'],
        ['guide.rst', 'restructuredtext']
    ];

    const files: Record<string, string> = {};
    for (const [name] of cases) {
        files[name] = 'x\n';
    }

    await withWorkspace(files, async root => {
        const markdown = await renderToText(cases.map(([name]) => embedded(root, name)));

        for (const [name, hint] of cases) {
            assert.equal(markdown.includes(`\`\`\`${hint}\nx\n`), true, name);
        }
    });
});

test('a file with no extension but a well-known name gets a language hint', async () => {
    const cases: [string, string][] = [
        ['Dockerfile', 'dockerfile'],
        ['Makefile', 'makefile'],
        ['Gemfile', 'ruby'],
        ['Jenkinsfile', 'groovy'],
        ['.gitignore', 'gitignore'],
        ['.bashrc', 'bash'],
        ['.editorconfig', 'ini']
    ];

    const files: Record<string, string> = {};
    for (const [name] of cases) {
        files[name] = 'x\n';
    }

    await withWorkspace(files, async root => {
        const markdown = await renderToText(cases.map(([name]) => embedded(root, name)));

        for (const [name, hint] of cases) {
            assert.equal(markdown.includes(`\`\`\`${hint}\nx\n`), true, name);
        }
    });
});

test('a well-known name wins over an extension that describes it worse', async () => {
    await withWorkspace({ 'CMakeLists.txt': 'project(x)\n' }, async root => {
        const markdown = await renderToText([embedded(root, 'CMakeLists.txt')]);

        assert.equal(markdown.includes('```cmake\nproject(x)\n'), true);
    });
});

test('the named families are recognised past their first member', async () => {
    await withWorkspace({
        'Dockerfile.builder': 'FROM scratch\n',
        'api.dockerfile': 'FROM scratch\n',
        '.env.production': 'KEY=value\n'
    }, async root => {
        // This test is about the language hint, not Redaction — a `.env.`
        // file's content is otherwise Redacted by design (see
        // redaction.test.ts), which would mask the literal 'value' this
        // assertion checks for.
        const markdown = await renderToText([
            embedded(root, 'Dockerfile.builder'),
            embedded(root, 'api.dockerfile'),
            embedded(root, '.env.production')
        ], resolvedConfiguration({ redactionEnabled: false }));

        assert.equal(markdown.match(/```dockerfile\nFROM scratch\n/g)?.length, 2);
        assert.equal(markdown.includes('```dotenv\nKEY=value\n'), true);
    });
});

test('a file with no extension and no known identity gets no language hint', async () => {
    await withWorkspace({ 'NOTICE': 'plain\n' }, async root => {
        const markdown = await renderToText([embedded(root, 'NOTICE')]);

        assert.equal(markdown.includes('```\nplain\n```'), true);
        assert.equal(/```[a-z]/.test(markdown), false);
    });
});

test('an extension that means more than one language gets no hint rather than a guess', async () => {
    await withWorkspace({ 'solver.m': 'x = 1;\n' }, async root => {
        const markdown = await renderToText([embedded(root, 'solver.m')]);

        assert.equal(markdown.includes('```\nx = 1;\n```'), true);
    });
});

test('a file containing a triple fence is embedded without breaking the enclosing block', async () => {
    const content = 'Before\n\n```js\nconst answer = 42;\n```\n\nAfter\n';

    await withWorkspace({ 'README.md': content, 'after.ts': 'export {};\n' }, async root => {
        const markdown = await renderToText([embedded(root, 'README.md'), embedded(root, 'after.ts')]);

        // Four backticks enclose three, so the file's own fence stays content.
        assert.equal(markdown.includes('````markdown\n' + content), true);
        assert.equal(markdown.includes('\n````\n'), true);
        // The entry after it is still a heading of the Export, not swallowed.
        assert.equal(markdown.includes('## after.ts'), true);
    });
});

test('a run of backticks straddling two reads is still counted whole', async () => {
    // Long enough that the run lands across a 64 KiB read boundary.
    const padding = 'x'.repeat(64 * 1024 - 2);
    const content = padding + '`'.repeat(5) + '\n';

    await withWorkspace({ 'wide.md': content }, async root => {
        const markdown = await renderToText([embedded(root, 'wide.md')]);

        assert.equal(markdown.includes('``````markdown\n'), true);
    });
});

test('entries are rendered in the order the Expansion returned them', async () => {
    await withWorkspace({ 'a.ts': '', 'b.ts': '', 'c.ts': '' }, async root => {
        const markdown = await renderToText([
            embedded(root, 'b.ts'),
            embedded(root, 'a.ts'),
            embedded(root, 'c.ts')
        ]);

        const positions = ['b.ts', 'a.ts', 'c.ts'].map(name => markdown.indexOf(`## ${name}`));
        assert.equal(positions.every(position => position >= 0), true);
        assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
    });
});

test('a Stub appears at its path, with its reason stated and its content omitted', async () => {
    await withWorkspace({ 'assets/logo.png': '' }, async root => {
        const markdown = await renderToText([{
            absolutePath: path.join(root, 'assets/logo.png'),
            relativePath: path.join('assets', 'logo.png'),
            classification: 'stub',
            reason: 'binary'
        }]);

        const section = sectionFor(markdown, path.join('assets', 'logo.png'));

        assert.equal(markdown.includes(path.join('assets', 'logo.png')), true);
        assert.match(section, /binary/);
        assert.equal(section.includes('```'), false);
    });
});

test('each Stub reason states itself in the Export', async () => {
    await withWorkspace({ 'logo.png': 'x', 'huge.log': 'x', 'locked.txt': 'x' }, async root => {
        const markdown = await renderToText([
            stub(root, 'logo.png', 'binary'),
            stub(root, 'huge.log', 'too-large'),
            stub(root, 'locked.txt', 'unreadable')
        ]);

        assert.match(markdown, /## logo\.png\n\n> \*\*Content omitted\*\* — this file is binary\./);
        assert.match(markdown, /## huge\.log\n\n> \*\*Content omitted\*\* — this file is larger than the/);
        assert.match(markdown, /## locked\.txt\n\n> \*\*Content omitted\*\* — this path could not be read\./);
    });
});

test('the too-large notice names the threshold the Export ran with', async () => {
    await withWorkspace({ 'huge.log': 'x' }, async root => {
        const destination = createBufferedDestination();
        await createExport({
            entries: [stub(root, 'huge.log', 'too-large')],
            configuration: resolvedConfiguration({ maxFileSizeBytes: 4096 }),
            destination
        });

        assert.match(destination.text(), /larger than the 4096-byte limit/);
    });
});

test('a Stub omits content the file on disk still has', async () => {
    await withWorkspace({ 'huge.log': 'secrets of the log\n' }, async root => {
        const markdown = await renderToText([stub(root, 'huge.log', 'too-large')]);

        assert.equal(markdown.includes('secrets of the log'), false);
        assert.equal(sectionFor(markdown, 'huge.log').includes('```'), false);
    });
});

test('an empty Expansion still produces an Export', async () => {
    const markdown = await renderToText([]);

    assert.equal(markdown.startsWith('# Project Code Export\n'), true);
});

test('the statistics report what the Export contained', async () => {
    await withWorkspace({ 'a.ts': 'one\n', 'b.ts': 'two\n' }, async root => {
        const destination = createBufferedDestination();
        const statistics = await createExport({
            entries: [
                embedded(root, 'a.ts'),
                {
                    absolutePath: path.join(root, 'huge.log'),
                    relativePath: 'huge.log',
                    classification: 'stub',
                    reason: 'too-large'
                },
                embedded(root, 'b.ts')
            ],
            configuration: resolvedConfiguration(),
            destination
        });

        assert.equal(statistics.entryCount, 3);
        assert.equal(statistics.embedCount, 2);
        assert.equal(statistics.stubCount, 1);
        assert.equal(statistics.characterCount, destination.text().length);
        // The total is the whole Export's, scaffolding included — the tree,
        // the headings, the fences — not only the two files' content, which
        // is why this is well past the 4 tokens 'one\n' and 'two\n' alone
        // would cost. The Stub contributes a notice but no file content.
        assert.equal(statistics.tokenCount, 117);
        assert.equal(statistics.tokenThresholdExceeded, false);
    });
});

test('an Export past the configured token threshold is reported as exceeding it', async () => {
    await withWorkspace({ 'a.ts': 'one\n' }, async root => {
        const statistics = await createExport({
            entries: [embedded(root, 'a.ts')],
            configuration: resolvedConfiguration({ tokenWarningThreshold: 1 }),
            destination: createBufferedDestination()
        });

        // The whole Export — tree, heading and fence included, not just the
        // four characters of 'one\n' — comes to 60 tokens here, past a
        // threshold of 1.
        assert.equal(statistics.tokenCount, 60);
        assert.equal(statistics.tokenThresholdExceeded, true);
    });
});

test('an Export at or under the configured token threshold is not reported as exceeding it', async () => {
    await withWorkspace({ 'a.ts': 'one\n' }, async root => {
        const statistics = await createExport({
            entries: [embedded(root, 'a.ts')],
            configuration: resolvedConfiguration({ tokenWarningThreshold: 1000 }),
            destination: createBufferedDestination()
        });

        assert.equal(statistics.tokenThresholdExceeded, false);
    });
});

test('a token threshold of zero means the Export never warns, however large', async () => {
    await withWorkspace({ 'a.ts': 'one\n'.repeat(5000) }, async root => {
        const statistics = await createExport({
            entries: [embedded(root, 'a.ts')],
            configuration: resolvedConfiguration({ tokenWarningThreshold: 0 }),
            destination: createBufferedDestination()
        });

        assert.equal(statistics.tokenCount > 0, true);
        assert.equal(statistics.tokenThresholdExceeded, false);
    });
});

test('content larger than one read is embedded exactly, multi-byte characters included', async () => {
    const content = 'ação — ✅\n'.repeat(20000);

    await withWorkspace({ 'big.txt': content }, async root => {
        const markdown = await renderToText([embedded(root, 'big.txt')]);

        assert.equal(markdown.includes(content), true);
    });
});

test('a file that vanished since it was classified says so in the Stub vocabulary', async () => {
    await withWorkspace({ 'present.ts': 'kept\n' }, async root => {
        const markdown = await renderToText([
            embedded(root, 'missing.ts'),
            embedded(root, 'present.ts')
        ]);

        // The renderer takes no view of its own on why content is missing: it
        // says what a Stub for the same reason would have said.
        assert.match(markdown, /\*\*Content omitted\*\* — this path could not be read\./);
        assert.equal(markdown.includes('kept\n'), true);
    });
});

test('the file Destination is written through as the Export is rendered, not at the end', async () => {
    await withWorkspace({ 'a.ts': 'one\n', 'b.ts': 'two\n', 'c.ts': 'three\n' }, async root => {
        const exportPath = path.join(root, 'EXPORT.md');
        const file = await openFileDestination(exportPath);
        const sizesSeen: number[] = [];

        const observed: ExportDestination = {
            async write(chunk: string): Promise<void> {
                await file.write(chunk);
                sizesSeen.push((await stat(exportPath)).size);
            }
        };

        try {
            await createExport({
                entries: ['a.ts', 'b.ts', 'c.ts'].map(name => embedded(root, name)),
                configuration: resolvedConfiguration(),
                destination: observed
            });
        } finally {
            await file.close();
        }

        // The document had reached disk long before the last entry was rendered.
        assert.equal(sizesSeen[0] > 0, true);
        assert.equal(sizesSeen[sizesSeen.length - 1], (await stat(exportPath)).size);
    });
});

test('a file Destination and a buffered Destination produce the same Export', async () => {
    await withWorkspace({
        '.gitignore': '*.log\n',
        'src/index.ts': 'export const answer = 42;\n',
        'src/deep/util.ts': 'export {};\n',
        'README.md': '# Title\n\ntext\n',
        'debug.log': 'noise\n'
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration(),
            exportFileName: 'EXPORT.md'
        });

        const buffered = createBufferedDestination();
        await createExport({ entries, configuration: resolvedConfiguration(), destination: buffered });

        const exportPath = path.join(root, 'EXPORT.md');
        const file = await openFileDestination(exportPath);
        try {
            await createExport({ entries, configuration: resolvedConfiguration(), destination: file });
        } finally {
            await file.close();
        }

        assert.equal(await readFile(exportPath, 'utf8'), buffered.text());
    });
});

test('an Export of a large Selection leaves the event loop free to run other work', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 300; index += 1) {
        files[`src/file-${index}.ts`] = `export const value${index} = ${index};\n`;
    }

    await withWorkspace(files, async root => {
        let ticks = 0;
        const timer = setInterval(() => { ticks += 1; }, 1);

        try {
            const entries = await expandSelection({
                selectionPaths: [root],
                workspaceRoot: root,
                configuration: resolvedConfiguration()
            });
            await createExport({
                entries,
                configuration: resolvedConfiguration(),
                destination: createBufferedDestination()
            });
        } finally {
            clearInterval(timer);
        }

        // A synchronous pipeline would have starved the timer completely.
        assert.equal(ticks > 0, true);
    });
});

test('rendering asked to run under an already aborted signal writes nothing', async () => {
    await withWorkspace({ 'a.ts': 'one\n' }, async root => {
        const controller = new AbortController();
        controller.abort();
        const destination = createBufferedDestination();

        await assert.rejects(
            createExport({
                entries: [embedded(root, 'a.ts')],
                configuration: resolvedConfiguration(),
                destination,
                signal: controller.signal
            }),
            ExportCancelled
        );

        assert.equal(destination.text(), '');
    });
});

test('rendering aborted part way through stops before the remaining entries', async () => {
    await withWorkspace({ 'a.ts': 'one\n', 'b.ts': 'two\n', 'c.ts': 'three\n' }, async root => {
        const controller = new AbortController();
        const destination = createBufferedDestination();

        await assert.rejects(
            createExport({
                entries: ['a.ts', 'b.ts', 'c.ts'].map(name => embedded(root, name)),
                configuration: resolvedConfiguration(),
                destination,
                signal: controller.signal,
                onProgress: update => {
                    // Once the first entry has been *rendered*: measuring
                    // runs first and reports too, and aborting there would
                    // stop the Export before a word of it had been written.
                    if (update.phase === 'rendering' && update.completed === 1) {
                        controller.abort();
                    }
                }
            }),
            ExportCancelled
        );

        assert.equal(destination.text().includes('one\n'), true);
        assert.equal(destination.text().includes('two\n'), false);
        assert.equal(destination.text().includes('three\n'), false);
    });
});

test('rendering a single very large file can still be cancelled', async () => {
    await withWorkspace({ 'big.txt': 'x'.repeat(4 * 1024 * 1024) }, async root => {
        const controller = new AbortController();
        const destination = createBufferedDestination();

        // Abort once the first chunk of the file has reached the Destination.
        const observed: ExportDestination = {
            async write(chunk: string): Promise<void> {
                await destination.write(chunk);
                if (chunk.startsWith('xxxx')) {
                    controller.abort();
                }
            }
        };

        await assert.rejects(
            createExport({
                entries: [embedded(root, 'big.txt')],
                configuration: resolvedConfiguration(),
                destination: observed,
                signal: controller.signal
            }),
            ExportCancelled
        );

        assert.equal(destination.text().length < 4 * 1024 * 1024, true);
    });
});

test('both passes report each entry against the total they were given', async () => {
    await withWorkspace({ 'a.ts': 'one\n', 'b.ts': 'two\n' }, async root => {
        const updates: { phase: string; completed: number; total?: number; detail?: string }[] = [];

        await createExport({
            entries: [
                embedded(root, 'a.ts'),
                {
                    absolutePath: path.join(root, 'huge.log'),
                    relativePath: 'huge.log',
                    classification: 'stub',
                    reason: 'too-large'
                },
                embedded(root, 'b.ts')
            ],
            configuration: resolvedConfiguration(),
            destination: createBufferedDestination(),
            onProgress: update => {
                updates.push({
                    phase: update.phase,
                    completed: update.completed,
                    total: update.total,
                    detail: update.detail
                });
            }
        });

        // Measuring reads every embedded file before the Export can name what
        // each one costs, so it is half the work and reports like the other
        // half. Both walk the same entries in the same order, Stubs included:
        // an entry the measuring pass had nothing to do for is still an entry
        // the user is waiting on.
        const perPhase = ['measuring', 'rendering'].map(phase => [
            { phase, completed: 1, total: 3, detail: 'a.ts' },
            { phase, completed: 2, total: 3, detail: 'huge.log' },
            { phase, completed: 3, total: 3, detail: 'b.ts' }
        ]).flat();

        assert.deepEqual(updates, perPhase);
    });
});

test('an Export of a hostile tree is well formed from end to end', async () => {
    if (process.getuid?.() === 0) {
        return;
    }

    const fenced = '# Notes\n\n```js\nconst answer = 42;\n```\n\nDone.\n';
    const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    await withWorkspace({
        'README.md': fenced,
        'build/module.wasm': wasm,
        'logs/debug.log': 'x'.repeat(4096),
        'secret.txt': 'classified',
        'src/index.ts': 'export const answer = 42;\n'
    }, async root => {
        const secret = path.join(root, 'secret.txt');
        await chmod(secret, 0o000);
        try {
            const configuration = resolvedConfiguration({ maxFileSizeBytes: 1024 });
            const entries = await expandSelection({
                selectionPaths: [root],
                workspaceRoot: root,
                configuration
            });

            const destination = createBufferedDestination();
            const statistics = await createExport({ entries, configuration, destination });
            const markdown = destination.text();

            assert.equal(statistics.entryCount, 5);
            assert.equal(statistics.embedCount, 2);
            assert.equal(statistics.stubCount, 3);

            // The fenced markdown is inside a wider fence, so the entry after
            // it is still a heading rather than the tail of a code block.
            assert.equal(markdown.includes('````markdown\n' + fenced), true);
            assert.match(markdown, /## build[/\\]module\.wasm\n\n> \*\*Content omitted\*\* — this file is binary\./);
            assert.match(markdown, /## logs[/\\]debug\.log\n\n> \*\*Content omitted\*\* — this file is larger than the 1024-byte limit\./);
            assert.match(markdown, /## secret\.txt\n\n> \*\*Content omitted\*\* — this path could not be read\./);
            assert.equal(markdown.includes('export const answer = 42;'), true);

            // Nothing binary reached the document as text.
            assert.equal(markdown.includes('\u0000'), false);

            // Every fence opened is a fence closed.
            const fences = markdown.match(/^`{3,}/gm) ?? [];
            assert.equal(fences.length % 2, 0);
        } finally {
            await chmod(secret, 0o644);
        }
    });
});
