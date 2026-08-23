import { open } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * How much of a file's opening is sniffed for a null byte. Text files large
 * enough to matter reveal themselves well inside this, and reading more would
 * cost the walk more than it buys.
 */
export const binarySniffBytes = 8 * 1024;

/**
 * Whether a file's extension is on the configured list. This is the cheap
 * half of the decision: it costs no read, but it only knows the extensions
 * somebody thought to list.
 */
export function hasBinaryExtension(filePath: string, binaryExtensions: string[]): boolean {
    const extension = path.extname(filePath).toLowerCase().slice(1);
    return binaryExtensions.includes(extension);
}

/**
 * Whether a null byte appears in the file's opening bytes.
 *
 * This is what catches the extensions the list does not know — `.wasm`,
 * `.pyc`, `.class`, `.db` — which are otherwise decoded as UTF-8 and embedded
 * as noise. A file that cannot be read throws; deciding that it is a Stub for
 * being unreadable rather than for being binary belongs to the caller.
 */
export async function hasBinaryContent(absolutePath: string): Promise<boolean> {
    const handle = await open(absolutePath, 'r');
    try {
        const buffer = Buffer.allocUnsafe(binarySniffBytes);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead).includes(0);
    } finally {
        await handle.close();
    }
}
