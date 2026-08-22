"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
var vscode = require("vscode");
var exportCommand_1 = require("./commands/exportCommand");
function activate(context) {
    var disposable = vscode.commands.registerCommand('markdownExport.export', exportCommand_1.exportCommand);
    context.subscriptions.push(disposable);
}
function deactivate() { }
