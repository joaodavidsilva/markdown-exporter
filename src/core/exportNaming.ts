import * as path from 'node:path';

/**
 * The name a file Destination writes an Export to, and the recognition of one
 * it has already written.
 *
 * Writing the name and recognising it are the same rule read in two
 * directions, so they live together: an Export that is not recognised is one
 * the next Export embeds whole, and a recognition wider than the rule would
 * take a user's own file out of their Export.
 */

/** A Destination that was configured with nothing usable still needs a name. */
const fallbackOutputFile = 'export.md';

/** `YYYY-MM-DD_HH-mm-ss`, as `timestamp` writes it. */
const timestampPattern = '\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}';

interface OutputName {
    /** The base name without its extension. */
    stem: string;
    /** The extension, including its dot, or empty where there is none. */
    extension: string;
}

/**
 * An Export is always written to the workspace root, whatever directory the
 * configured output file names, so only its base name shapes the result.
 */
function splitOutputFile(outputFile: string): OutputName {
    const rawBase = path.basename(outputFile).trim();
    const baseName = rawBase.length === 0 ? fallbackOutputFile : rawBase;
    const extension = path.extname(baseName);
    const stem = extension ? baseName.slice(0, baseName.length - extension.length) : baseName;
    return { stem, extension };
}

function timestamp(now: Date): string {
    const pad = (value: number): string => value.toString().padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `${date}_${time}`;
}

function escapeForRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What this Export will be called: the configured base name, a timestamp, and
 * the configured extension. The timestamp is what keeps successive Exports
 * from overwriting each other.
 */
export function timestampedExportName(outputFile: string, now: Date = new Date()): string {
    const { stem, extension } = splitOutputFile(outputFile);
    return `${stem}_${timestamp(now)}${extension}`;
}

/**
 * Whether this file name is one a file Destination wrote — an Export from an
 * earlier run, which no later Export should contain.
 *
 * The rule is the narrowest one that recognises them: exactly the shape
 * `timestampedExportName` produces for the configured output file, timestamp
 * included. A user's own `FULL_CODE_notes.md` is not an Export and stays in
 * their Export; only a name that the extension itself could have written is
 * taken out.
 */
export function isExportFileName(fileName: string, outputFile: string): boolean {
    const { stem, extension } = splitOutputFile(outputFile);
    const shape = new RegExp(
        `^${escapeForRegExp(stem)}_${timestampPattern}${escapeForRegExp(extension)}$`
    );
    return shape.test(fileName);
}
