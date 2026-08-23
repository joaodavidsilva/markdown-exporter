import * as vscode from 'vscode';
import { ProgressUpdate } from '../core/progress';

/** What the notification accepts, narrowed to the part this bridge uses. */
type NotificationProgress = vscode.Progress<{ message?: string; increment?: number }>;

/** Do not move the notification more often than this, in milliseconds. */
const minimumIntervalMs = 100;

/**
 * How much of the bar each phase after the Expansion owns.
 *
 * Measuring reads every embedded file — for its fence and its token count —
 * before the Export's tree can be written, so it is roughly half the work
 * that follows an Expansion and is given roughly half the bar. Leaving it out
 * would put the bar back where this rebuild found it: motionless through the
 * part of the run the user is actually waiting on.
 */
const phaseSpans: Record<'measuring' | 'rendering', { from: number; to: number }> = {
    measuring: { from: 0, to: 0.5 },
    rendering: { from: 0.5, to: 1 }
};

/** What the notification calls each phase. */
const phaseVerbs: Record<'measuring' | 'rendering', string> = {
    measuring: 'Measuring',
    rendering: 'Rendering'
};

/**
 * Turn the counts the core reports into what the notification shows.
 *
 * The bar means one thing only: the fraction of the entries that has been
 * measured and rendered. An Expansion cannot know its own total until it has
 * finished, so it moves the message and not the bar — a bar creeping forward
 * against a total nobody knows is a guess dressed up as progress.
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

        const span = phaseSpans[update.phase];
        const total = update.total ?? update.completed;
        const share = total > 0 ? update.completed / total : 1;
        const fraction = span.from + share * (span.to - span.from);
        const increment = Math.max(0, (fraction - reportedFraction) * 100);
        reportedFraction = Math.max(reportedFraction, fraction);

        const detail = update.detail ? ` — ${update.detail}` : '';
        progress.report({
            increment,
            message: `${phaseVerbs[update.phase]} ${update.completed} of ${total}${detail}`
        });
    };
}
