import { open } from 'node:fs/promises';

/**
 * Where an Export is delivered. The Export is handed over chunk by chunk, so
 * a Destination that can write through never holds the whole document.
 */
export interface ExportDestination {
    write(chunk: string): Promise<void>;
}

/** A file Destination, which owns an open handle until it is closed. */
export interface FileDestination extends ExportDestination {
    close(): Promise<void>;
}

/**
 * Write through to a file as the Export is rendered, rather than buffering the
 * whole document and writing it at the end.
 */
export async function openFileDestination(absolutePath: string): Promise<FileDestination> {
    const handle = await open(absolutePath, 'w');

    return {
        async write(chunk: string): Promise<void> {
            await handle.write(chunk, null, 'utf8');
        },
        async close(): Promise<void> {
            await handle.close();
        }
    };
}

/** A Destination that accumulates the Export in memory. */
export interface BufferedDestination extends ExportDestination {
    text(): string;
}

/**
 * Buffer the Export in memory. The clipboard Destination needs a complete
 * string, and so do tests that assert on what an Export contains.
 */
export function createBufferedDestination(): BufferedDestination {
    const chunks: string[] = [];

    return {
        write(chunk: string): Promise<void> {
            chunks.push(chunk);
            return Promise.resolve();
        },
        text(): string {
            return chunks.join('');
        }
    };
}
