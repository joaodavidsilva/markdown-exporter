import * as path from 'node:path';
import * as vscode from 'vscode';
import { ResolvedConfiguration } from '../core/configuration';
import { createFileDelivery } from '../core/destinations';
import { ChosenDestination, runExportCommand } from './runExport';

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

/**
 * The file Destination: a timestamped file in the workspace root, so
 * successive Exports do not overwrite each other. Its name travels with the
 * Destination because the Expansion has to leave the in-flight Export out of
 * the Export it is producing.
 */
function toFile(workspaceRoot: string, configuration: ResolvedConfiguration): ChosenDestination {
    const exportFileName = timestampedName(configuration.outputFile);
    const exportPath = path.join(workspaceRoot, exportFileName);

    return {
        delivery: createFileDelivery(exportPath),
        exportFileName,
        completionMessage: `Export written to the file ${exportPath}`
    };
}

export function exportCommand(
    uri: vscode.Uri | undefined,
    uris: vscode.Uri[] | undefined
): Promise<void> {
    return runExportCommand(toFile, uri, uris);
}
