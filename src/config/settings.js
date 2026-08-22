"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfiguration = getConfiguration;
var vscode = require("vscode");
function getConfiguration() {
    var config = vscode.workspace.getConfiguration('markdownExport');
    return {
        outputFile: config.get('outputFile', 'FULL_CODE.md'),
        additionalIgnore: config.get('additionalIgnore', []),
        binaryFileExtensions: config.get('binaryFileExtensions', getDefaultBinaryExtensions()),
        binaryFiles: config.get('binaryFiles', [])
    };
}
function getDefaultBinaryExtensions() {
    return [
        "png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "ico",
        "avif", "heic", "heif",
        "mp4", "mov", "avi", "mkv", "webm", "mpeg", "mpg", "3gp", "ogv",
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
        "zip", "rar", "7z", "gz", "tar",
        "exe", "dll", "so", "dylib"
    ];
}
