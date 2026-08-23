import * as vscode from 'vscode';
import { ProgressUpdate } from '../core/progress';

/** What the notification accepts, narrowed to the part this bridge uses. */
type NotificationProgress = vscode.Progress<{ message?: string; increment?: number }>;

/** Do not move the notification more often than this, in milliseconds. */
const minimumIntervalMs = 100;

/**
 * Turn the counts the core reports into what the notification shows.
 *
 * The bar means one thing only: the fraction of the entries that has been
 * rendered. An Expansion cannot know its own total until it has finished, so
 * it moves the message and not the bar — a bar creeping forward against a
 * total nobody knows is a guess dressed up as progress.
 *
 * Updates arrive once per file, which is far more often than a notification
 * can usefully change, so they are throttled. The bar tracks the fraction
 * reported so far rather than each increment, so a dropped update is folded
 * into the next one instead of being lost.
 */
export function createProgressBridge(
    progress: NotificationProgress
): (update: ProgressUpdate) => void {
    let lastReportedAt = 0;
    let lastReportedPhase: ProgressUpdate['phase'] | undefined;
    let reportedFraction = 0;

    return update => {
        // The first unit of a phase and the last one always get through, so
        // the notification never sits on a phase that has already ended and
        // never stops short of finished.
        const isFirstUnit = update.completed <= 1 || update.phase !== lastReportedPhase;
        const isFinalUnit = update.total !== undefined && update.completed >= update.total;
        const now = Date.now();
        if (!isFirstUnit && !isFinalUnit && now - lastReportedAt < minimumIntervalMs) {
            return;
        }
        lastReportedAt = now;
        lastReportedPhase = update.phase;

        if (update.phase === 'expansion') {
            progress.report({ message: `Expanding Selection — ${update.completed} files found` });
            return;
        }

        const total = update.total ?? update.completed;
        const fraction = total > 0 ? update.completed / total : 1;
        const increment = Math.max(0, (fraction - reportedFraction) * 100);
        reportedFraction = fraction;

        const detail = update.detail ? ` — ${update.detail}` : '';
        progress.report({
            increment,
            message: `Rendering ${update.completed} of ${total}${detail}`
        });
    };
}
