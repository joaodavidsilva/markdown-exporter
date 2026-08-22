import * as assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';
import { createBufferedDestination, ExportDestination, openFileDestination } from '../core/destinations';
import { createExport } from '../core/export';
import { expandSelection, ExpansionEntry } from '../core/expansion';
import { resolvedConfiguration, withWorkspace } from './workspace';

function embedded(root: string, relativePath: string): ExpansionEntry {
    return {
        absolutePath: path.join(root, relativePath),
        relativePath,
        classification: 'embed'
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

        assert.equal(markdown.includes('```typescript\nconst answer = 42;\n\n```'), true);
    });
});

test('a file whose extension has no known language gets a fence with no hint', async () => {
    await withWorkspace({ 'notes.zzz': 'plain\n' }, async root => {
        const markdown = await renderToText([embedded(root, 'notes.zzz')]);

        assert.equal(markdown.includes('```\nplain\n'), true);
        assert.equal(/```zzz/.test(markdown), false);
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

test('a file that cannot be opened leaves a notice and the Export continues', async () => {
    await withWorkspace({ 'present.ts': 'kept\n' }, async root => {
        const markdown = await renderToText([
            embedded(root, 'missing.ts'),
            embedded(root, 'present.ts')
        ]);

        assert.match(markdown, /Error reading file content\./);
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
