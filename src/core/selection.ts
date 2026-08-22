import * as vscode from 'vscode';

export function getSelectionPaths(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined, workspaceRoot: string): string[] {
    if (uris && uris.length > 0) {
        return uris.map(u => u.fsPath);
    }
    
    if (uri) {
        return [uri.fsPath];
    }
    
    return [workspaceRoot];
}