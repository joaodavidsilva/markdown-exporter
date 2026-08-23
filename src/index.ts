import * as vscode from 'vscode';
import { copyCommand } from './commands/copyCommand';
import { exportCommand } from './commands/exportCommand';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('markdownExport.export', exportCommand),
        vscode.commands.registerCommand('markdownExport.copy', copyCommand)
    );
}

export function deactivate() {}
