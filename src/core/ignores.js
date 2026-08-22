"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldIgnoreFile = shouldIgnoreFile;
var path = require("path");
var gitignore_1 = require("./gitignore");
var binaryDetection_1 = require("./binaryDetection");
var settings_1 = require("../config/settings");
function shouldIgnoreFile(filePath, workspaceRoot, outputFilePath) {
    var relativePath = path.relative(workspaceRoot, filePath);
    var config = (0, settings_1.getConfiguration)();
    var gitignoreFilter = (0, gitignore_1.createGitignoreFilter)(workspaceRoot);
    if (gitignoreFilter(filePath)) {
        return true;
    }
    if (config.additionalIgnore.includes(relativePath)) {
        return true;
    }
    var defaultOutputFilePath = path.join(workspaceRoot, config.outputFile);
    if (filePath === defaultOutputFilePath) {
        return true;
    }
    if (outputFilePath && filePath === outputFilePath) {
        return true;
    }
    if (config.binaryFiles.includes(relativePath)) {
        return true;
    }
    if ((0, binaryDetection_1.isBinaryFile)(filePath, config.binaryFileExtensions)) {
        return true;
    }
    return false;
}
