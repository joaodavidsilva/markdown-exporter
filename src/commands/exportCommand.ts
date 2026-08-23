import * as path from 'node:path';
import * as vscode from 'vscode';
import { ResolvedConfiguration } from '../core/configuration';
import { createFileDelivery } from '../core/destinations';
import { timestampedExportName } from '../core/exportNaming';
import { ChosenDestination, runExportCommand } from './runExport';

/**
 * The file Destination: a timestamped file in the workspace root, so
 * successive Exports do not overwrite each other. Its name travels with the
 * Destination because the Expansion has to leave the in-flight Export out of
 * the Export it is producing.
 *
 * The name itself is the core's to shape, since the core is also what has to
 * recognise one of these files when a later Export walks past it.
 */
function toFile(workspaceRoot: string, configuration: ResolvedConfiguration): ChosenDestination {
    const exportFileName = timestampedExportName(configuration.outputFile);
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
