import * as vscode from 'vscode';
import { createClipboardDelivery } from '../core/destinations';
import { ChosenDestination, runExportCommand } from './runExport';

/**
 * The clipboard Destination, which writes no file at all — which is the point
 * of it: most Exports are only ever pasted somewhere, and the ones written to
 * the workspace had to be deleted afterwards.
 *
 * No file means no `exportFileName`: there is no in-flight Export for the
 * Expansion to leave out. The configured output file is excluded either way,
 * so a copied Export still never contains a previous one.
 */
function toClipboard(): ChosenDestination {
    return {
        delivery: createClipboardDelivery(async text => {
            await vscode.env.clipboard.writeText(text);
        }),
        completionMessage: 'Export copied to the clipboard'
    };
}

export function copyCommand(
    uri: vscode.Uri | undefined,
    uris: vscode.Uri[] | undefined
): Promise<void> {
    return runExportCommand(toClipboard, uri, uris);
}
