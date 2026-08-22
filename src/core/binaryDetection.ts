import * as path from 'path';

export function isBinaryFile(filePath: string, binaryExtensions: string[]): boolean {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    return binaryExtensions.includes(ext);
}