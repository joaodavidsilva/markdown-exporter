import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { ExportCancelled, throwIfCancelled } from './cancellation';
import { ResolvedConfiguration } from './configuration';
import { ExportDestination } from './destinations';
import { EmbeddedEntry, ExpansionEntry, StubEntry, StubReason } from './expansion';
import { languageHintFor } from './languages';
import { ProgressReporter } from './progress';

/** How much of a file is read at a time, so no file is held whole in memory. */
const readChunkBytes = 64 * 1024;

/** The byte a fence is made of, and the shortest fence markdown accepts. */
const backtickByte = 0x60;
const minimumFenceLength = 3;

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
    /** Aborts the rendering between entries and between file chunks. */
    signal?: AbortSignal;
    /** Called as entries are rendered. The total is known from the outset. */
    onProgress?: ProgressReporter;
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
    const { entries, destination, signal, onProgress } = request;

    throwIfCancelled(signal);

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

    let completed = 0;

    for (const entry of entries) {
        throwIfCancelled(signal);

        await write(`## ${entry.relativePath}\n\n`);

        if (entry.classification === 'stub') {
            statistics.stubCount += 1;
            await writeStub(entry, write);
        } else {
            statistics.embedCount += 1;
            await writeEmbeddedContent(entry, write, signal);
        }

        await write('---\n\n');

        completed += 1;
        onProgress?.({
            phase: 'rendering',
            completed,
            total: entries.length,
            detail: entry.relativePath
        });
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
    write: (chunk: string) => Promise<void>,
    signal?: AbortSignal
): Promise<void> {
    let handle: FileHandle;
    try {
        handle = await open(entry.absolutePath, 'r');
    } catch {
        await write(unreadableNotice);
        return;
    }

    try {
        // The whole file is scanned before a single character is written, so
        // that the fence can be made longer than anything inside it and a file
        // that fails to be read leaves a notice rather than an open block.
        let fence: string;
        try {
            fence = fenceOf(await longestBacktickRun(handle, signal));
        } catch (error) {
            if (error instanceof ExportCancelled) {
                throw error;
            }
            await write(unreadableNotice);
            return;
        }

        await write(`${fence}${languageHintFor(entry.absolutePath)}\n`);

        let failed = false;
        try {
            await streamContent(handle, write, signal);
        } catch (error) {
            if (error instanceof ExportCancelled) {
                throw error;
            }
            // The file was readable a moment ago, so it changed underneath the
            // Export. Close the block before saying so, rather than leaving a
            // fence open and corrupting everything after it.
            failed = true;
        }

        await write(`\n${fence}\n\n`);

        if (failed) {
            await write(unreadableNotice);
        }
    } finally {
        await handle.close();
    }
}

/**
 * The longest unbroken run of backticks anywhere in the file.
 *
 * Scanning raw bytes is safe: a backtick is ASCII, and no byte of a multi-byte
 * UTF-8 sequence is ever below 0x80. A run straddling two chunks is counted as
 * one, since the count carries across the boundary.
 */
async function longestBacktickRun(handle: FileHandle, signal?: AbortSignal): Promise<number> {
    const buffer = Buffer.allocUnsafe(readChunkBytes);
    let position = 0;
    let longest = 0;
    let current = 0;

    for (;;) {
        throwIfCancelled(signal);

        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) {
            return longest;
        }
        position += bytesRead;

        for (let index = 0; index < bytesRead; index += 1) {
            if (buffer[index] === backtickByte) {
                current += 1;
                if (current > longest) {
                    longest = current;
                }
            } else {
                current = 0;
            }
        }
    }
}

/**
 * A fence one backtick longer than the longest run in the content it will
 * enclose, which is what makes corruption by an embedded fence impossible.
 */
function fenceOf(longestRun: number): string {
    return '`'.repeat(Math.max(minimumFenceLength, longestRun + 1));
}

/** Hand the file's decoded content to the Destination chunk by chunk. */
async function streamContent(
    handle: FileHandle,
    write: (chunk: string) => Promise<void>,
    signal?: AbortSignal
): Promise<void> {
    const buffer = Buffer.allocUnsafe(readChunkBytes);
    const decoder = new StringDecoder('utf8');
    let position = 0;

    for (;;) {
        // Between chunks as well as between entries, so that a single very
        // large file can still be cancelled.
        throwIfCancelled(signal);

        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) {
            break;
        }
        position += bytesRead;

        const text = decoder.write(buffer.subarray(0, bytesRead));
        if (text.length > 0) {
            await write(text);
        }
    }

    const trailing = decoder.end();
    if (trailing.length > 0) {
        await write(trailing);
    }
}
