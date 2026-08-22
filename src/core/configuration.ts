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
    /** Exact relative paths excluded on top of the other Exclusion sources. */
    additionalIgnore: string[];
    /** Extensions (without a dot) treated as binary. */
    binaryFileExtensions: string[];
    /** Exact relative paths treated as binary. */
    binaryFiles: string[];
}

export const defaultBinaryFileExtensions: readonly string[] = [
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'ico',
    'avif', 'heic', 'heif',
    'mp4', 'mov', 'avi', 'mkv', 'webm', 'mpeg', 'mpg', '3gp', 'ogv',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'rar', '7z', 'gz', 'tar',
    'exe', 'dll', 'so', 'dylib'
];
