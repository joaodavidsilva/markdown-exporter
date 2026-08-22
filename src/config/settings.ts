import * as vscode from 'vscode';

export interface ExportConfig {
    outputFile: string;
    additionalIgnore: string[];
    binaryFileExtensions: string[];
    binaryFiles: string[];
}

export function getConfiguration(): ExportConfig {
    const config = vscode.workspace.getConfiguration('markdownExport');
    
    return {
        outputFile: config.get<string>('outputFile', 'FULL_CODE.md'),
        additionalIgnore: config.get<string[]>('additionalIgnore', []),
        binaryFileExtensions: config.get<string[]>('binaryFileExtensions', getDefaultBinaryExtensions()),
        binaryFiles: config.get<string[]>('binaryFiles', [])
    };
}

function getDefaultBinaryExtensions(): string[] {
    return [
        "png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "ico",
        "avif", "heic", "heif",
        "mp4", "mov", "avi", "mkv", "webm", "mpeg", "mpg", "3gp", "ogv",
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
        "zip", "rar", "7z", "gz", "tar",
        "exe", "dll", "so", "dylib"
    ];
}