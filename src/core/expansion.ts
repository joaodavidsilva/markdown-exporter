import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { ResolvedConfiguration } from './configuration';
import { compileExclusions, CompiledExclusions } from './exclusions';

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
}

/**
 * The first seam. Walks a Selection down to the ordered list of entries that
 * will appear in the Export, applying every Exclusion along the way and
 * classifying what survives.
 */
export async function expandSelection(request: ExpansionRequest): Promise<ExpansionEntry[]> {
    const { selectionPaths, workspaceRoot, configuration, exportFileName } = request;

    // Once per Export, not once per file: every Exclusion source is read and
    // compiled here, and the walk below only ever asks the compiled rules.
    const exclusions = await compileExclusions(workspaceRoot, configuration, exportFileName);

    const filePaths: string[] = [];

    for (const selectionPath of selectionPaths) {
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
            filePaths.push(selectionPath);
            continue;
        }

        await collectDirectory(selectionPath, exclusions, filePaths);
    }

    filePaths.sort();

    return filePaths.map(absolutePath => classify(absolutePath, workspaceRoot));
}

async function collectDirectory(
    directoryPath: string,
    exclusions: CompiledExclusions,
    filePaths: string[]
): Promise<void> {
    const items = await readdir(directoryPath);

    for (const item of items) {
        const itemPath = path.join(directoryPath, item);

        if (exclusions.excludes(itemPath)) {
            continue;
        }

        const stats = await stat(itemPath);
        if (stats.isDirectory()) {
            await collectDirectory(itemPath, exclusions, filePaths);
        } else {
            filePaths.push(itemPath);
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
