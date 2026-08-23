import * as vscode from 'vscode';
import { getWorkspaceRoot } from '../adapter/paths';
import { createProgressBridge } from '../adapter/progress';
import { getSelectionPaths } from '../adapter/selection';
import { getConfiguration } from '../config/settings';
import { ExportCancelled } from '../core/cancellation';
import { ResolvedConfiguration } from '../core/configuration';
import { deliverExport } from '../core/delivery';
import { DestinationDelivery } from '../core/destinations';
import { expandSelection } from '../core/expansion';
import { ExportStatistics } from '../core/export';
import { approximateTokens, groupDigits } from '../core/tokenCounting';

/**
 * How a run ended, and — when it produced one — what the Export turned out to
 * contain. A cancelled run has no Export and so no statistics to report.
 */
type Outcome =
    | { kind: 'cancelled' }
    | { kind: 'completed'; statistics: ExportStatistics };

/**
 * The Destination one command exports to, and what to say once the Export has
 * arrived there. This is the whole of the difference between the commands:
 * everything else about a run — the workspace root, the Selection, the
 * configuration, the progress, the cancellation, the single failure message —
 * is the same wherever the Export is going.
 */
export interface ChosenDestination {
    delivery: DestinationDelivery;
    /**
     * The file this Export writes into the workspace root, so the Expansion
     * can leave it out. Undefined for a Destination that writes no file.
     */
    exportFileName?: string;
    /**
     * What the user is told when the Export is delivered. It names the
     * Destination, because that is the one thing the two commands do not
     * share and the only way to tell one completed Export from the other.
     */
    completionMessage: string;
}

/** Chosen once the workspace root and the configuration are known. */
export type ChooseDestination = (
    workspaceRoot: string,
    configuration: ResolvedConfiguration
) => ChosenDestination;

interface ExportRun {
    selectionPaths: string[];
    workspaceRoot: string;
    configuration: ResolvedConfiguration;
    destination: ChosenDestination;
    progress: vscode.Progress<{ message?: string; increment?: number }>;
    token: vscode.CancellationToken;
}

/**
 * One Export, from a Selection in the explorer to a delivered document.
 *
 * A command supplies its Destination and nothing else. An Export is an Export
 * whichever way it leaves, so both commands are announced, reported and
 * cancelled identically, and a change to any of that reaches both.
 */
export async function runExportCommand(
    chooseDestination: ChooseDestination,
    uri: vscode.Uri | undefined,
    uris: vscode.Uri[] | undefined
): Promise<void> {
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
        const destination = chooseDestination(workspaceRoot, configuration);

        const outcome = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Exporting to Markdown',
            cancellable: true
        }, (progress, token) => runExport({
            selectionPaths,
            workspaceRoot,
            configuration,
            destination,
            progress,
            token
        }));

        if (outcome.kind === 'cancelled') {
            void vscode.window.showInformationMessage('Markdown Exporter: Export cancelled');
            return;
        }

        report(destination, configuration, outcome.statistics);
    } catch (error) {
        // One failure, one message. Everything that can fail throws out of the
        // progress callback rather than reporting on the way past, so this is
        // the only place an Export is ever reported as failed.
        const message = error instanceof Error ? error.message : 'Unknown error';
        void vscode.window.showErrorMessage(`Markdown Exporter: Export failed (${message})`);
    }
}

/**
 * What the user is told once the Export has arrived.
 *
 * The token count belongs here rather than inside the Export, for the same
 * reason the tree's per-file counts belong inside it: the total is a fact
 * about the whole document, and the document cannot state a total it is still
 * being counted into. The number is said as approximate wherever it appears —
 * it comes from one vocabulary and the user will paste into another.
 *
 * The Redaction count sits beside it for the same reason, in the same
 * message rather than a second notification: it is said every time, zero
 * included, because zero is itself the answer to the question that count
 * exists to settle — whether this Selection carried a secret at all.
 *
 * Past the threshold the same sentence arrives as a warning instead, so an
 * oversized Export is caught at the moment it is made rather than at the
 * moment it is pasted.
 */
function report(
    destination: ChosenDestination,
    configuration: ResolvedConfiguration,
    statistics: ExportStatistics
): void {
    const tokens = `${approximateTokens(statistics.tokenCount)} (approximate)`;
    const redactions =
        `${groupDigits(statistics.redactionCount)} ${statistics.redactionCount === 1 ? 'redaction' : 'redactions'}`;
    const summary = `Markdown Exporter: ${destination.completionMessage} — ${tokens}, ${redactions}`;

    if (statistics.tokenThresholdExceeded) {
        const threshold = groupDigits(configuration.tokenWarningThreshold);
        void vscode.window.showWarningMessage(
            `${summary}, above the ${threshold}-token warning threshold`
        );
        return;
    }

    void vscode.window.showInformationMessage(summary);
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
            exportFileName: run.destination.exportFileName,
            signal: controller.signal,
            onProgress: reportProgress
        });

        // Whatever the Destination is, it is opened only after the Expansion
        // has finished, and it is handed the Export only once the rendering
        // has, so cancelling leaves nothing behind either way.
        const statistics = await deliverExport({
            entries,
            configuration: run.configuration,
            delivery: run.destination.delivery,
            signal: controller.signal,
            onProgress: reportProgress
        });

        return { kind: 'completed', statistics };
    } catch (error) {
        if (error instanceof ExportCancelled) {
            return { kind: 'cancelled' };
        }
        throw error;
    } finally {
        subscription.dispose();
    }
}
