import * as vscode from 'vscode';

export function getWorkspaceRoot(): string | undefined {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return undefined;
    }
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
}