import * as vscode from 'vscode';
import { exportCommand } from './commands/exportCommand';

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('markdownExport.export', exportCommand);
    context.subscriptions.push(disposable);
}

export function deactivate() {}