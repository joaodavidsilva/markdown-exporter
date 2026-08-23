import * as assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';
import { ExportCancelled } from '../core/cancellation';
import { deliverExport } from '../core/delivery';
import {
    createBufferedDestination,
    createClipboardDelivery,
    createFileDelivery,
    DestinationDelivery,
    ExportDestination
} from '../core/destinations';
import { createExport } from '../core/export';
import { expandSelection, ExpansionEntry } from '../core/expansion';
import { ProgressUpdate } from '../core/progress';
import { resolvedConfiguration, withWorkspace } from './workspace';

/** A Selection worth several chunks, so cancelling has somewhere to land. */
const workspaceFiles = {
    'src/index.ts': 'export const a = 1;\n',
    'src/deep/other.ts': 'export const b = 2;\n',
    'README.md': '# Title\n\nSome prose.\n'
};

function entriesOf(root: string): Promise<ExpansionEntry[]> {
    return expandSelection({
        selectionPaths: [root],
        workspaceRoot: root,
        configuration: resolvedConfiguration()
    });
}

/** What the same entries render to when nothing interrupts them. */
async function renderedText(entries: ExpansionEntry[]): Promise<string> {
    const destination = createBufferedDestination();
    await createExport({ entries, configuration: resolvedConfiguration(), destination });
    return destination.text();
}

/** A clipboard, and every text ever put on it. */
function recordingClipboard(): { writes: string[]; delivery: DestinationDelivery } {
    const writes: string[] = [];
    const delivery = createClipboardDelivery(text => {
        writes.push(text);
        return Promise.resolve();
    });
    return { writes, delivery };
}

/** A Destination that stops accepting the Export part of the way through. */
function failingAfter(delivery: DestinationDelivery, chunks: number): DestinationDelivery {
    return {
        async open(): Promise<ExportDestination> {
            const destination = await delivery.open();
            let written = 0;
            return {
                async write(chunk: string): Promise<void> {
                    written += 1;
                    if (written > chunks) {
                        throw new Error('the Destination stopped accepting the Export');
                    }
                    await destination.write(chunk);
                }
            };
        },
        commit: () => delivery.commit(),
        discard: () => delivery.discard()
    };
}

/** Abort the moment the rendering reports its first entry. */
function abortWhileRendering(controller: AbortController): (update: ProgressUpdate) => void {
    return update => {
        if (update.phase === 'rendering') {
            controller.abort();
        }
    };
}

test('an Export delivered to the clipboard arrives whole', async () => {
    await withWorkspace(workspaceFiles, async root => {
        const entries = await entriesOf(root);
        const clipboard = recordingClipboard();

        await deliverExport({
            entries,
            configuration: resolvedConfiguration(),
            delivery: clipboard.delivery
        });

        assert.equal(clipboard.writes.length, 1);
        assert.equal(clipboard.writes[0], await renderedText(entries));
    });
});

test('an Export delivered to a file arrives whole', async () => {
    await withWorkspace(workspaceFiles, async root => {
        const entries = await entriesOf(root);
        const exportPath = path.join(root, 'EXPORT.md');

        await deliverExport({
            entries,
            configuration: resolvedConfiguration(),
            delivery: createFileDelivery(exportPath)
        });

        assert.equal(await readFile(exportPath, 'utf8'), await renderedText(entries));
    });
});

test('an Export cancelled while rendering leaves nothing on the clipboard', async () => {
    await withWorkspace(workspaceFiles, async root => {
        const entries = await entriesOf(root);
        const clipboard = recordingClipboard();
        const controller = new AbortController();

        await assert.rejects(
            deliverExport({
                entries,
                configuration: resolvedConfiguration(),
                delivery: clipboard.delivery,
                signal: controller.signal,
                onProgress: abortWhileRendering(controller)
            }),
            ExportCancelled
        );

        assert.deepEqual(clipboard.writes, []);
    });
});

test('an Export cancelled while rendering leaves no file behind', async () => {
    await withWorkspace(workspaceFiles, async root => {
        const entries = await entriesOf(root);
        const exportPath = path.join(root, 'EXPORT.md');
        const controller = new AbortController();

        await assert.rejects(
            deliverExport({
                entries,
                configuration: resolvedConfiguration(),
                delivery: createFileDelivery(exportPath),
                signal: controller.signal,
                onProgress: abortWhileRendering(controller)
            }),
            ExportCancelled
        );

        await assert.rejects(stat(exportPath), /ENOENT/);
    });
});

test('an Export cancelled before it is rendered never opens its Destination', async () => {
    await withWorkspace(workspaceFiles, async root => {
        const entries = await entriesOf(root);
        const controller = new AbortController();
        controller.abort();

        let opened = 0;
        const delivery: DestinationDelivery = {
            open(): Promise<ExportDestination> {
                opened += 1;
                return Promise.resolve(createBufferedDestination());
            },
            commit: () => Promise.resolve(),
            discard: () => Promise.resolve()
        };

        await assert.rejects(
            deliverExport({
                entries,
                configuration: resolvedConfiguration(),
                delivery,
                signal: controller.signal
            }),
            ExportCancelled
        );

        assert.equal(opened, 0);
    });
});

test('an Export that fails while rendering leaves nothing on the clipboard', async () => {
    await withWorkspace(workspaceFiles, async root => {
        const entries = await entriesOf(root);
        const clipboard = recordingClipboard();

        await assert.rejects(
            deliverExport({
                entries,
                configuration: resolvedConfiguration(),
                delivery: failingAfter(clipboard.delivery, 3)
            }),
            /stopped accepting/
        );

        assert.deepEqual(clipboard.writes, []);
    });
});

test('an Export that fails while rendering leaves no file behind', async () => {
    await withWorkspace(workspaceFiles, async root => {
        const entries = await entriesOf(root);
        const exportPath = path.join(root, 'EXPORT.md');

        await assert.rejects(
            deliverExport({
                entries,
                configuration: resolvedConfiguration(),
                delivery: failingAfter(createFileDelivery(exportPath), 3)
            }),
            /stopped accepting/
        );

        await assert.rejects(stat(exportPath), /ENOENT/);
    });
});

test('an Export is handed over only once it has been rendered in full', async () => {
    await withWorkspace(workspaceFiles, async root => {
        const entries = await entriesOf(root);
        const events: string[] = [];

        const delivery: DestinationDelivery = {
            open(): Promise<ExportDestination> {
                events.push('open');
                return Promise.resolve({
                    write(): Promise<void> {
                        events.push('write');
                        return Promise.resolve();
                    }
                });
            },
            commit(): Promise<void> {
                events.push('commit');
                return Promise.resolve();
            },
            discard(): Promise<void> {
                events.push('discard');
                return Promise.resolve();
            }
        };

        await deliverExport({ entries, configuration: resolvedConfiguration(), delivery });

        assert.equal(events[0], 'open');
        assert.equal(events[events.length - 1], 'commit');
        assert.ok(events.filter(event => event === 'write').length > 1);
        assert.ok(!events.includes('discard'));
    });
});

test('a Destination that fails to take the Export is not left holding half of it', async () => {
    await withWorkspace(workspaceFiles, async root => {
        const entries = await entriesOf(root);
        let discarded = 0;

        const delivery: DestinationDelivery = {
            open: () => Promise.resolve(createBufferedDestination()),
            commit: () => Promise.reject(new Error('the clipboard refused the Export')),
            discard: () => {
                discarded += 1;
                return Promise.resolve();
            }
        };

        await assert.rejects(
            deliverExport({ entries, configuration: resolvedConfiguration(), delivery }),
            /refused/
        );

        assert.equal(discarded, 1);
    });
});
