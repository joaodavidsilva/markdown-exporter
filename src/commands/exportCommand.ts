import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getWorkspaceRoot } from '../adapter/paths';
import { createProgressBridge } from '../adapter/progress';
import { getSelectionPaths } from '../adapter/selection';
import { getConfiguration } from '../config/settings';
import { ExportCancelled } from '../core/cancellation';
import { ResolvedConfiguration } from '../core/configuration';
import { openFileDestination } from '../core/destinations';
import { createExport } from '../core/export';
import { expandSelection } from '../core/expansion';

type Outcome = 'completed' | 'cancelled';

interface ExportRun {
    selectionPaths: string[];
    workspaceRoot: string;
    configuration: ResolvedConfiguration;
    /** The name this Export writes to, so the Expansion can leave it out. */
    exportFileName: string;
    exportPath: string;
    progress: vscode.Progress<{ message?: string; increment?: number }>;
    token: vscode.CancellationToken;
}

function generateTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function timestampedName(outputFile: string): string {
    const rawBase = path.basename(outputFile).trim();
    const baseName = rawBase.length === 0 ? 'export.md' : rawBase;
    const extension = path.extname(baseName);
    const nameOnly = extension ? baseName.slice(0, baseName.length - extension.length) : baseName;
    return `${nameOnly}_${generateTimestamp()}${extension}`;
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
        const configuration = getConfiguration();
        const exportFileName = timestampedName(configuration.outputFile);
        const exportPath = path.join(workspaceRoot, exportFileName);

        const outcome = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Exporting to Markdown',
            cancellable: true
        }, (progress, token) => runExport({
            selectionPaths,
            workspaceRoot,
            configuration,
            exportFileName,
            exportPath,
            progress,
            token
        }));

        if (outcome === 'cancelled') {
            void vscode.window.showInformationMessage('Markdown Exporter: Export cancelled');
            return;
        }

        void vscode.window.showInformationMessage(`Markdown Exporter: Export completed successfully (${exportPath})`);
    } catch (error) {
        // One failure, one message. Everything that can fail throws out of the
        // progress callback rather than reporting on the way past, so this is
        // the only place an Export is ever reported as failed.
        const message = error instanceof Error ? error.message : 'Unknown error';
        void vscode.window.showErrorMessage(`Markdown Exporter: Export failed (${message})`);
    }
}

async function runExport(run: ExportRun): Promise<Outcome> {
    const controller = new AbortController();
    const subscription = run.token.onCancellationRequested(() => controller.abort());
    const reportProgress = createProgressBridge(run.progress);

    try {
        const entries = await expandSelection({
            selectionPaths: run.selectionPaths,
            workspaceRoot: run.workspaceRoot,
            configuration: run.configuration,
            exportFileName: run.exportFileName,
            signal: controller.signal,
            onProgress: reportProgress
        });

        // The file is opened only once the Expansion has finished, so
        // cancelling during the walk never creates one to clean up.
        const destination = await openFileDestination(run.exportPath);
        try {
            try {
                await createExport({
                    entries,
                    configuration: run.configuration,
                    destination,
                    signal: controller.signal,
                    onProgress: reportProgress
                });
            } finally {
                await destination.close();
            }
        } catch (error) {
            // The Destination writes through, so a failure can leave a partial
            // Export behind. Remove it rather than hand back half a document —
            // and a cancellation arrives here by the same route, so it leaves
            // nothing behind either.
            await rm(run.exportPath, { force: true });
            throw error;
        }

        return 'completed';
    } catch (error) {
        if (error instanceof ExportCancelled) {
            return 'cancelled';
        }
        throw error;
    } finally {
        subscription.dispose();
    }
}
