import type { Stats } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { hasBinaryContent, hasBinaryExtension } from './binaryDetection';
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
 *
 * An Exclusion and a Stub are not two names for the same thing. An Exclusion
 * removes a file so completely that the Export gives no sign it existed; a
 * Stub is a decision to mention the file and omit its content, with the reason
 * stated. Both decisions are taken here, and nowhere else.
 */
export async function expandSelection(request: ExpansionRequest): Promise<ExpansionEntry[]> {
    const { selectionPaths, workspaceRoot, configuration, exportFileName, signal } = request;

    throwIfCancelled(signal);

    // Once per Export, not once per file: every Exclusion source is read and
    // compiled here, and the walk below only ever asks the compiled rules.
    const exclusions = await compileExclusions(workspaceRoot, configuration, exportFileName);

    const walk: Walk = { request, exclusions, found: [] };

    for (const selectionPath of selectionPaths) {
        throwIfCancelled(signal);

        // A picked path is resolved through its link if it is one: the user
        // pointed at it deliberately. That resolution happens once, before any
        // walking, so it cannot be the step that a cycle rides on.
        let stats: Stats;
        try {
            stats = await stat(selectionPath);
        } catch {
            continue;
        }

        if (stats.isFile()) {
            if (!exclusions.excludes(selectionPath)) {
                record(walk, { absolutePath: selectionPath, sizeBytes: stats.size });
            }
            continue;
        }

        if (!stats.isDirectory()) {
            continue;
        }

        // Only the built-in suppression is consulted for a picked folder: what
        // the user's own Exclusion rules do to a directory they picked
        // outright is a question this ticket deliberately leaves open.
        if (exclusions.suppresses(selectionPath)) {
            continue;
        }

        await collectDirectory(selectionPath, walk);
    }

    walk.found.sort(byAbsolutePath);

    const classifier = createClassifier(workspaceRoot, configuration);
    const entries: ExpansionEntry[] = [];

    for (const candidate of walk.found) {
        throwIfCancelled(signal);
        entries.push(await classifier(candidate));
    }

    return entries;
}

/**
 * Something the walk found and the classification has yet to judge, unless the
 * walk itself already knows it can only be a Stub.
 */
interface Candidate {
    absolutePath: string;
    /** Size in bytes, when the walk already learnt it. */
    sizeBytes?: number;
    /** Set when the walk itself established the entry is a Stub. */
    reason?: StubReason;
}

/** The state one Expansion carries down through the walk. */
interface Walk {
    request: ExpansionRequest;
    exclusions: CompiledExclusions;
    found: Candidate[];
}

function byAbsolutePath(left: Candidate, right: Candidate): number {
    if (left.absolutePath === right.absolutePath) {
        return 0;
    }
    return left.absolutePath < right.absolutePath ? -1 : 1;
}

function record(walk: Walk, candidate: Candidate): void {
    walk.found.push(candidate);
    walk.request.onProgress?.({
        phase: 'expansion',
        completed: walk.found.length,
        detail: path.relative(walk.request.workspaceRoot, candidate.absolutePath)
    });
}

async function collectDirectory(directoryPath: string, walk: Walk): Promise<void> {
    throwIfCancelled(walk.request.signal);

    let items: string[];
    try {
        items = await readdir(directoryPath);
    } catch {
        // One directory the user cannot read used to cost the whole Export.
        // It becomes a Stub at its own path instead: the Export says the
        // folder is there and that nothing could be read out of it, and the
        // rest of the Selection is exported as normal.
        record(walk, { absolutePath: directoryPath, reason: 'unreadable' });
        return;
    }

    for (const item of items) {
        throwIfCancelled(walk.request.signal);

        const itemPath = path.join(directoryPath, item);

        if (walk.exclusions.excludes(itemPath)) {
            continue;
        }

        let link: Stats;
        try {
            link = await lstat(itemPath);
        } catch {
            record(walk, { absolutePath: itemPath, reason: 'unreadable' });
            continue;
        }

        if (link.isSymbolicLink()) {
            await collectLink(itemPath, walk);
            continue;
        }

        if (link.isDirectory()) {
            await collectDirectory(itemPath, walk);
            continue;
        }

        // Anything that is neither a file nor a directory — a socket, a fifo,
        // a device — is left alone. Opening one can block for ever, and none
        // of them is what anybody meant by picking a folder.
        if (link.isFile()) {
            record(walk, { absolutePath: itemPath, sizeBytes: link.size });
        }
    }
}

/**
 * What the walk does with a symlink it found. `lstat` reported the link
 * itself, so nothing here has followed anything yet.
 */
async function collectLink(linkPath: string, walk: Walk): Promise<void> {
    let target: Stats;
    try {
        target = await stat(linkPath);
    } catch {
        // A link pointing nowhere used to throw straight out of the walk. It
        // is a Stub: the path is in the Selection, and there is no content
        // behind it to read.
        record(walk, { absolutePath: linkPath, reason: 'unreadable' });
        return;
    }

    // A directory symlink is never followed. A link back up its own tree would
    // otherwise walk for ever, and one pointing sideways would export the same
    // files twice under two names.
    if (target.isFile()) {
        record(walk, { absolutePath: linkPath, sizeBytes: target.size });
    }
}

/**
 * Judge one candidate: embedded, or a Stub with the reason stated.
 *
 * The order is the order of certainty and of cost. What the configuration
 * declares binary is settled without reading anything; size follows, because a
 * file too large to embed is too large to sniff; the content sniff comes last,
 * and it is the one that catches the extensions nobody listed.
 */
function createClassifier(
    workspaceRoot: string,
    configuration: ResolvedConfiguration
): (candidate: Candidate) => Promise<ExpansionEntry> {
    const binaryFiles = new Set(configuration.binaryFiles);
    const { maxFileSizeBytes } = configuration;

    return async (candidate: Candidate): Promise<ExpansionEntry> => {
        const { absolutePath } = candidate;
        const relativePath = path.relative(workspaceRoot, absolutePath);

        const stubbed = (reason: StubReason): StubEntry => ({
            absolutePath,
            relativePath,
            classification: 'stub',
            reason
        });

        if (candidate.reason) {
            return stubbed(candidate.reason);
        }

        if (binaryFiles.has(relativePath)) {
            return stubbed('binary');
        }

        if (hasBinaryExtension(absolutePath, configuration.binaryFileExtensions)) {
            return stubbed('binary');
        }

        let sizeBytes = candidate.sizeBytes;
        if (sizeBytes === undefined) {
            try {
                sizeBytes = (await stat(absolutePath)).size;
            } catch {
                return stubbed('unreadable');
            }
        }

        // A threshold of zero, or less, is read as no threshold at all rather
        // than as a rule that stubs every file in the Selection.
        if (maxFileSizeBytes > 0 && sizeBytes > maxFileSizeBytes) {
            return stubbed('too-large');
        }

        try {
            if (await hasBinaryContent(absolutePath)) {
                return stubbed('binary');
            }
        } catch {
            return stubbed('unreadable');
        }

        return { absolutePath, relativePath, classification: 'embed' };
    };
}
