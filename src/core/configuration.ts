/**
 * The configuration an Export runs with, resolved to a plain value.
 *
 * ADR-0001: the core never reaches out for settings. The adapter reads them
 * once, at its boundary, and hands the result down. Every core function that
 * needs configuration takes one of these.
 */
export interface ResolvedConfiguration {
    /** Base name of the file Destination, relative to the workspace root. */
    outputFile: string;
    /**
     * Paths and `.gitignore`-syntax globs excluded on top of the other
     * Exclusion sources, and above all of them. An entry with no glob
     * character in it is an exact path relative to the workspace root.
     */
    additionalIgnore: string[];
    /** Extensions (without a dot) treated as binary. */
    binaryFileExtensions: string[];
    /** Exact relative paths treated as binary. */
    binaryFiles: string[];
    /**
     * Above this many bytes a file becomes a Stub rather than being embedded.
     * Zero, or anything below it, means no limit.
     */
    maxFileSizeBytes: number;
    /**
     * Above this many approximate tokens an Export is reported with a
     * warning rather than as ordinary news. Zero, or anything below it,
     * means never warn.
     */
    tokenWarningThreshold: number;
    /**
     * Whether Redaction runs at all. On by default, since a Selection is
     * more likely to contain a secret by accident than on purpose; off is
     * for the deliberate case — exporting a fixture built with fake keys,
     * where masking them would misrepresent the fixture itself.
     */
    redactionEnabled: boolean;
}

/**
 * A source file this side of a megabyte is the ordinary case; past it a file
 * is almost always generated, vendored or a log, and embedding it whole costs
 * the rest of the Export its room.
 */
export const defaultMaxFileSizeBytes = 1024 * 1024;

/**
 * The narrowest context window an Export is likely to be pasted into. Past it
 * the Export may still fit the model in front of the user, which is why this
 * is a warning and not a limit.
 */
export const defaultTokenWarningThreshold = 128_000;

/**
 * Redaction defaults to on: a Selection that happens to contain a secret is
 * the case worth protecting against by default, and turning it off is one
 * setting away for the fixture-export case that needs to.
 */
export const defaultRedactionEnabled = true;

export const defaultBinaryFileExtensions: readonly string[] = [
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'ico',
    'avif', 'heic', 'heif',
    'mp4', 'mov', 'avi', 'mkv', 'webm', 'mpeg', 'mpg', '3gp', 'ogv',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'rar', '7z', 'gz', 'tar',
    'exe', 'dll', 'so', 'dylib'
];
