"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.walkFiles = walkFiles;
var fs = require("fs");
var path = require("path");
var ignores_1 = require("./ignores");
function walkFiles(inputPaths, workspaceRoot, outputFilePath) {
    var allFiles = [];
    for (var _i = 0, inputPaths_1 = inputPaths; _i < inputPaths_1.length; _i++) {
        var inputPath = inputPaths_1[_i];
        if (!fs.existsSync(inputPath)) {
            continue;
        }
        if (fs.statSync(inputPath).isFile()) {
            if (!(0, ignores_1.shouldIgnoreFile)(inputPath, workspaceRoot, outputFilePath)) {
                allFiles.push(inputPath);
            }
            continue;
        }
        var files = walkDirectory(inputPath, workspaceRoot, outputFilePath);
        allFiles.push.apply(allFiles, files);
    }
    return allFiles.sort();
}
function walkDirectory(dirPath, workspaceRoot, outputFilePath) {
    var files = [];
    function traverse(currentPath) {
        var items = fs.readdirSync(currentPath);
        for (var _i = 0, items_1 = items; _i < items_1.length; _i++) {
            var item = items_1[_i];
            var itemPath = path.join(currentPath, item);
            if ((0, ignores_1.shouldIgnoreFile)(itemPath, workspaceRoot, outputFilePath)) {
                continue;
            }
            if (fs.statSync(itemPath).isDirectory()) {
                traverse(itemPath);
            }
            else {
                files.push(itemPath);
            }
        }
    }
    traverse(dirPath);
    return files;
}
