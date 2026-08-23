/**
 * How an Export in flight is interrupted.
 *
 * The editor's own cancellation type stays in the adapter (ADR-0001). What
 * crosses the seams is `AbortSignal`, a platform primitive the core can
 * observe without knowing anything about who aborted it or why.
 */

/** Raised by a seam when the caller aborted the Export it was running. */
export class ExportCancelled extends Error {
    constructor() {
        super('Export cancelled');
        this.name = 'ExportCancelled';
    }
}

/**
 * Stop here if the Export has been cancelled. Called between filesystem
 * steps, which is what makes a long walk or a large file interruptible.
 */
export function throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new ExportCancelled();
    }
}
