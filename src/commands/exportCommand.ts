import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfiguration } from '../config/settings';
import { expandSelection, ExpansionEntry } from '../core/expansion';
import { buildMarkdown } from '../core/markdownBuilder';
import { getWorkspaceRoot } from '../adapter/paths';
import { getSelectionPaths } from '../adapter/selection';

function generateTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

export async function exportCommand(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined): Promise<void> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        void vscode.window.showErrorMessage('Markdown Exporter: No workspace folder found');
        return;
    }

    const selectionPaths = getSelectionPaths(uri, uris, workspaceRoot);
    if (selectionPaths.length === 0) {
        void vscode.window.showWarningMessage('Markdown Exporter: No files or folders selected');
        return;
    }

    try {
        // Build timestamped output file name
        const config = getConfiguration();
    const rawBase = path.basename(config.outputFile).trim();
    const baseName = rawBase.length === 0 ? 'export.md' : rawBase;
        const ext = path.extname(baseName);
    const nameOnly = ext ? baseName.slice(0, baseName.length - ext.length) : baseName;
        const stampedName = `${nameOnly}_${generateTimestamp()}${ext}`;
    const stampedPath = path.join(workspaceRoot, stampedName);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Exporting to Markdown',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Scanning files...' });
            let entries: ExpansionEntry[] = [];
            try {
                entries = await expandSelection({
                    selectionPaths,
                    workspaceRoot,
                    configuration: config,
                    exportFileName: stampedName
                });
            } catch (walkErr) {
                const msg = walkErr instanceof Error ? walkErr.message : String(walkErr);
                void vscode.window.showErrorMessage(`Markdown Exporter: Failed scanning files (${msg})`);
                return;
            }

            progress.report({ increment: 50, message: 'Building markdown...' });
            try {
                await buildMarkdown(entries.map(entry => entry.absolutePath), workspaceRoot, config, stampedName);
            } catch (mdErr) {
                const msg = mdErr instanceof Error ? mdErr.message : String(mdErr);
                void vscode.window.showErrorMessage(`Markdown Exporter: Failed building markdown (${msg})`);
                return;
            }
            progress.report({ increment: 100, message: 'Done!' });
        });
        // Verify file existence (defensive)
        if (!fs.existsSync(stampedPath)) {
            void vscode.window.showErrorMessage(`Markdown Exporter: Expected output not found (${stampedPath})`);
        } else {
            void vscode.window.showInformationMessage(`Markdown Exporter: Export completed successfully (${stampedPath})`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        void vscode.window.showErrorMessage(`Markdown Exporter: Export failed (${message})`);
    }
}