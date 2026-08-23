/**
 * How a seam says how far it has got.
 *
 * The core reports counts, not percentages or notification updates: turning
 * them into whatever the editor shows is the adapter's job (ADR-0001).
 */

/** Which half of the pipeline an update comes from. */
export type ExportPhase = 'expansion' | 'rendering';

export interface ProgressUpdate {
    phase: ExportPhase;
    /** Units finished so far in this phase. Only ever grows. */
    completed: number;
    /**
     * Units this phase will finish, when that is known in advance. An
     * Expansion does not know how many files it will find until it has found
     * them, so it reports a growing count with no total rather than inventing
     * a fraction.
     */
    total?: number;
    /** What was just finished, for a human reading the notification. */
    detail?: string;
}

export type ProgressReporter = (update: ProgressUpdate) => void;
