"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkspaceRoot = getWorkspaceRoot;
var vscode = require("vscode");
function getWorkspaceRoot() {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return undefined;
    }
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
}
