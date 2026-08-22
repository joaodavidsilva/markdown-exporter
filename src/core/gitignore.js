"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGitignoreFilter = createGitignoreFilter;
var fs = require("fs");
var path = require("path");
var ignore_1 = require("ignore");
function createGitignoreFilter(workspaceRoot) {
    var gitignorePath = path.join(workspaceRoot, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        return function () { return false; };
    }
    var gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    var ig = (0, ignore_1.default)().add(gitignoreContent);
    return function (filePath) {
        var relativePath = path.relative(workspaceRoot, filePath);
        return ig.ignores(relativePath);
    };
}
