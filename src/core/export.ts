import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { ResolvedConfiguration } from './configuration';
import { ExportDestination } from './destinations';
import { EmbeddedEntry, ExpansionEntry, StubEntry, StubReason } from './expansion';
import { languageHintFor } from './languages';

/** How much of a file is read at a time, so no file is held whole in memory. */
const readChunkBytes = 64 * 1024;

const unreadableNotice = 'Error reading file content.\n\n';

const stubNotices: Record<StubReason, string> = {
    'binary': 'Content omitted: this file is binary.\n\n',
    'too-large': 'Content omitted: this file is too large.\n\n',
    'unreadable': 'Content omitted: this file could not be read.\n\n'
};

/** Everything the rendering needs, resolved by the adapter (ADR-0001). */
export interface ExportRequest {
    /** The output of expandSelection, in the order it will be rendered. */
    entries: ExpansionEntry[];
    configuration: ResolvedConfiguration;
    destination: ExportDestination;
}

/** What an Export turned out to contain. */
export interface ExportStatistics {
    entryCount: number;
    embedCount: number;
    stubCount: number;
    characterCount: number;
}

/**
 * The second seam. Renders an Expansion into an Export, handing it to the
 * Destination as it goes rather than assembling the whole document first.
 */
export async function createExport(request: ExportRequest): Promise<ExportStatistics> {
    const { entries, destination } = request;

    const statistics: ExportStatistics = {
        entryCount: entries.length,
        embedCount: 0,
        stubCount: 0,
        characterCount: 0
    };

    const write = async (chunk: string): Promise<void> => {
        statistics.characterCount += chunk.length;
        await destination.write(chunk);
    };

    await write('# Project Code Export\n\n');
    await write('## Index\n\n');

    for (const entry of entries) {
        await write(`- [${entry.relativePath}](#${entry.relativePath.replace(/[/\\.]/g, '-')})\n`);
    }

    await write('\n---\n\n');

    for (const entry of entries) {
        await write(`## ${entry.relativePath}\n\n`);

        if (entry.classification === 'stub') {
            statistics.stubCount += 1;
            await writeStub(entry, write);
        } else {
            statistics.embedCount += 1;
            await writeEmbeddedContent(entry, write);
        }

        await write('---\n\n');
    }

    return statistics;
}

async function writeStub(entry: StubEntry, write: (chunk: string) => Promise<void>): Promise<void> {
    await write(stubNotices[entry.reason]);
}

/**
 * Stream one file into its fence. The file is read in chunks and handed on as
 * it arrives, so neither the file nor the Export is ever held whole.
 */
async function writeEmbeddedContent(
    entry: EmbeddedEntry,
    write: (chunk: string) => Promise<void>
): Promise<void> {
    let handle: FileHandle;
    try {
        handle = await open(entry.absolutePath, 'r');
    } catch {
        await write(unreadableNotice);
        return;
    }

    try {
        const buffer = Buffer.allocUnsafe(readChunkBytes);
        const decoder = new StringDecoder('utf8');

        // Read the opening chunk before the fence, so a file that fails to be
        // read leaves a notice rather than an empty code block.
        let bytesRead: number;
        try {
            ({ bytesRead } = await handle.read(buffer, 0, buffer.length, null));
        } catch {
            await write(unreadableNotice);
            return;
        }

        await write(`\`\`\`${languageHintFor(entry.absolutePath)}\n`);

        while (bytesRead > 0) {
            const text = decoder.write(buffer.subarray(0, bytesRead));
            if (text.length > 0) {
                await write(text);
            }
            ({ bytesRead } = await handle.read(buffer, 0, buffer.length, null));
        }

        const trailing = decoder.end();
        if (trailing.length > 0) {
            await write(trailing);
        }

        await write('\n```\n\n');
    } finally {
        await handle.close();
    }
}
