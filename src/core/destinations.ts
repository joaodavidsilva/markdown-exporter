import { open, rm } from 'node:fs/promises';

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

/**
 * A Destination together with the two moments that decide whether an Export
 * ever reaches it.
 *
 * An Export is delivered only once it has been rendered in full, so one that
 * was cancelled or that failed leaves nothing behind: no half-written file,
 * nothing on the clipboard.
 */
export interface DestinationDelivery {
    /** Open the Destination the Export is rendered into. */
    open(): Promise<ExportDestination>;
    /** The Export is complete: hand it over. */
    commit(): Promise<void>;
    /** The Export was cancelled or failed: leave the Destination as it was. */
    discard(): Promise<void>;
}

/**
 * Deliver an Export to a file, written through as it is rendered.
 *
 * Writing through is what keeps a large Export out of memory, and it is also
 * what gives the failure path work to do: the bytes are already on disk, so
 * discarding means removing them.
 */
export function createFileDelivery(absolutePath: string): DestinationDelivery {
    let file: FileDestination | undefined;

    const close = async (): Promise<void> => {
        const open = file;
        file = undefined;
        if (open) {
            await open.close();
        }
    };

    return {
        async open(): Promise<ExportDestination> {
            file = await openFileDestination(absolutePath);
            return file;
        },
        commit: close,
        async discard(): Promise<void> {
            try {
                await close();
            } catch {
                // The handle is being abandoned either way. What matters here
                // is that the partial Export does not survive.
            }
            await rm(absolutePath, { force: true });
        }
    };
}

/**
 * Deliver an Export to the clipboard, which necessarily buffers: the
 * clipboard takes one complete string, so there is nothing to write through
 * to. The asymmetry with the file Destination is bounded by what a human will
 * paste.
 *
 * `writeText` is handed in because the clipboard belongs to the editor and
 * the core does not import it (ADR-0001). Nothing is written to it until the
 * Export is whole, which is what keeps a cancelled Export off the clipboard.
 */
export function createClipboardDelivery(
    writeText: (text: string) => Promise<void>
): DestinationDelivery {
    let buffer = createBufferedDestination();

    return {
        open(): Promise<ExportDestination> {
            buffer = createBufferedDestination();
            return Promise.resolve(buffer);
        },
        commit(): Promise<void> {
            return writeText(buffer.text());
        },
        discard(): Promise<void> {
            buffer = createBufferedDestination();
            return Promise.resolve();
        }
    };
}
