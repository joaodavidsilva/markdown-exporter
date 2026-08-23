import * as assert from 'node:assert/strict';
import { chmod, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';
import { ExportCancelled } from '../core/cancellation';
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

async function renderToText(entries: ExpansionEntry[]): Promise<string> {
    const destination = createBufferedDestination();
    await createExport({ entries, configuration: resolvedConfiguration(), destination });
    return destination.text();
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

test('a longer run of backticks widens the fence further', async () => {
    const content = 'a\n``````\nb\n';

    await withWorkspace({ 'notes.md': content }, async root => {
        const markdown = await renderToText([embedded(root, 'notes.md')]);

        assert.equal(markdown.includes('```````markdown\n' + content), true);
        assert.equal(markdown.includes('\n```````\n'), true);
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

test('a file with no backticks in it keeps the ordinary three-backtick fence', async () => {
    await withWorkspace({ 'plain.ts': 'const answer = 42;\n' }, async root => {
        const markdown = await renderToText([embedded(root, 'plain.ts')]);

        assert.equal(markdown.includes('```typescript\n'), true);
        assert.equal(markdown.includes('````'), false);
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

        assert.equal(markdown.includes(path.join('assets', 'logo.png')), true);
        assert.match(markdown, /binary/);
        assert.equal(markdown.includes('```'), false);
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
        assert.equal(markdown.includes('```'), false);
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
                    if (update.completed === 1) {
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

test('rendering reports each entry against the total it was given', async () => {
    await withWorkspace({ 'a.ts': 'one\n', 'b.ts': 'two\n' }, async root => {
        const updates: { completed: number; total?: number; detail?: string }[] = [];

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
                assert.equal(update.phase, 'rendering');
                updates.push({ completed: update.completed, total: update.total, detail: update.detail });
            }
        });

        assert.deepEqual(updates, [
            { completed: 1, total: 3, detail: 'a.ts' },
            { completed: 2, total: 3, detail: 'huge.log' },
            { completed: 3, total: 3, detail: 'b.ts' }
        ]);
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
