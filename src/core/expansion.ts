import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { throwIfCancelled } from './cancellation';
import { ResolvedConfiguration } from './configuration';
import { compileExclusions, CompiledExclusions } from './exclusions';
import { ProgressReporter } from './progress';

/** Why an entry is a Stub: mentioned at its path, with its content omitted. */
export type StubReason = 'binary' | 'too-large' | 'unreadable';

/** An entry whose content is embedded in the Export. */
export interface EmbeddedEntry {
    absolutePath: string;
    relativePath: string;
    classification: 'embed';
}

/** An entry that appears at its path with its content deliberately omitted. */
export interface StubEntry {
    absolutePath: string;
    relativePath: string;
    classification: 'stub';
    reason: StubReason;
}

/**
 * One file that will appear in the Export, already classified. Deciding
 * between embed and Stub belongs to the Expansion and nowhere else; rendering
 * only obeys what it is handed.
 */
export type ExpansionEntry = EmbeddedEntry | StubEntry;

/** Everything the Expansion needs, resolved by the adapter (ADR-0001). */
export interface ExpansionRequest {
    /** Absolute paths the user picked in the explorer. */
    selectionPaths: string[];
    workspaceRoot: string;
    configuration: ResolvedConfiguration;
    /** File name this Export writes to, so it cannot include itself. */
    exportFileName?: string;
    /** Aborts the walk between filesystem steps. */
    signal?: AbortSignal;
    /** Called as files are found. The total is unknown until the walk ends. */
    onProgress?: ProgressReporter;
}

/**
 * The first seam. Walks a Selection down to the ordered list of entries that
 * will appear in the Export, applying every Exclusion along the way and
 * classifying what survives.
 */
export async function expandSelection(request: ExpansionRequest): Promise<ExpansionEntry[]> {
    const { selectionPaths, workspaceRoot, configuration, exportFileName, signal } = request;

    throwIfCancelled(signal);

    // Once per Export, not once per file: every Exclusion source is read and
    // compiled here, and the walk below only ever asks the compiled rules.
    const exclusions = await compileExclusions(workspaceRoot, configuration, exportFileName);

    const walk: Walk = { request, exclusions, filePaths: [] };

    for (const selectionPath of selectionPaths) {
        throwIfCancelled(signal);

        let stats;
        try {
            stats = await stat(selectionPath);
        } catch {
            continue;
        }

        if (exclusions.excludes(selectionPath)) {
            continue;
        }

        if (stats.isFile()) {
            found(walk, selectionPath);
            continue;
        }

        await collectDirectory(selectionPath, walk);
    }

    walk.filePaths.sort();

    return walk.filePaths.map(absolutePath => classify(absolutePath, workspaceRoot));
}

/** The state one Expansion carries down through the walk. */
interface Walk {
    request: ExpansionRequest;
    exclusions: CompiledExclusions;
    filePaths: string[];
}

function found(walk: Walk, filePath: string): void {
    walk.filePaths.push(filePath);
    walk.request.onProgress?.({
        phase: 'expansion',
        completed: walk.filePaths.length,
        detail: path.relative(walk.request.workspaceRoot, filePath)
    });
}

async function collectDirectory(directoryPath: string, walk: Walk): Promise<void> {
    throwIfCancelled(walk.request.signal);

    const items = await readdir(directoryPath);

    for (const item of items) {
        throwIfCancelled(walk.request.signal);

        const itemPath = path.join(directoryPath, item);

        if (walk.exclusions.excludes(itemPath)) {
            continue;
        }

        const stats = await stat(itemPath);
        if (stats.isDirectory()) {
            await collectDirectory(itemPath, walk);
        } else {
            found(walk, itemPath);
        }
    }
}

/**
 * Binary files are removed by an Exclusion during the walk today, so nothing
 * reaches here that should be a Stub. The classification travels with the
 * entry so that the decision has one home when Stubs arrive.
 */
function classify(absolutePath: string, workspaceRoot: string): ExpansionEntry {
    return {
        absolutePath,
        relativePath: path.relative(workspaceRoot, absolutePath),
        classification: 'embed'
    };
}
