import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { ExportCancelled, throwIfCancelled } from './cancellation';
import { ResolvedConfiguration } from './configuration';
import { ExportDestination } from './destinations';
import { EmbeddedEntry, ExpansionEntry, StubReason } from './expansion';
import { renderFileTree } from './fileTree';
import { languageHintFor } from './languages';
import { ProgressReporter } from './progress';
import { createTokenTally, TokenTally, tokenVocabulary } from './tokenCounting';

/** How much of a file is read at a time, so no file is held whole in memory. */
const readChunkBytes = 64 * 1024;

/** The byte a fence is made of, and the shortest fence markdown accepts. */
const backtickByte = 0x60;
const minimumFenceLength = 3;

/**
 * What an Export says where a Stub's content would have been.
 *
 * A Stub is read by a model as often as by a person, so the notice has to say
 * three things without being mistaken for the file's own content: that
 * something was left out, that leaving it out was deliberate, and why. A
 * blockquote is the tool speaking rather than the file, and stating the
 * threshold in the notice saves the reader guessing what "too large" meant on
 * the machine the Export was made on.
 */
function stubNotices(configuration: ResolvedConfiguration): Record<StubReason, string> {
    const notice = (reason: string): string => `> **Content omitted** — ${reason}.\n\n`;

    return {
        'binary': notice('this file is binary'),
        'too-large': notice(
            `this file is larger than the ${configuration.maxFileSizeBytes}-byte limit`
        ),
        'unreadable': notice('this path could not be read')
    };
}

/**
 * What the counts in the tree are, said once where they are first read.
 *
 * Every count in the Export carries a tilde, but a tilde only says that a
 * number is loose — not why, and not by how much it might matter. A reader
 * deciding whether an Export fits their model's window deserves to know the
 * count came from one particular vocabulary and that theirs is another.
 */
const approximationNotice =
    `Token counts are approximate: they are taken from the ${tokenVocabulary} ` +
    'vocabulary, and other model families tokenize differently.';

/** Everything the rendering needs, resolved by the adapter (ADR-0001). */
export interface ExportRequest {
    /** The output of expandSelection, in the order it will be rendered. */
    entries: ExpansionEntry[];
    configuration: ResolvedConfiguration;
    destination: ExportDestination;
    /** Aborts the rendering between entries and between file chunks. */
    signal?: AbortSignal;
    /** Called as entries are rendered. The total is known from the outset. */
    onProgress?: ProgressReporter;
}

/** What an Export turned out to contain. */
export interface ExportStatistics {
    entryCount: number;
    embedCount: number;
    stubCount: number;
    characterCount: number;
    /** Approximate tokens in the whole Export, scaffolding included. */
    tokenCount: number;
    /** Whether that total went past the threshold the Export ran with. */
    tokenThresholdExceeded: boolean;
}

/**
 * What was learnt about one embedded file before a character of the Export
 * was written: how long its fence has to be, and how many tokens its content
 * is worth.
 */
interface Measurement {
    fence: string;
    tokenCount: number;
}

/**
 * The second seam. Renders an Expansion into an Export, handing it to the
 * Destination as it goes rather than assembling the whole document first.
 *
 * The rendering happens in two passes over the *files*, never over the
 * document: the Export itself is written once, streamed out, and never held.
 * The first pass measures each embedded file — the longest run of backticks
 * in it, which the fence has to clear, and its token count, which the tree
 * has to state — and the second writes the Export. That costs no extra read:
 * the fence always needed a scan of the whole file before its first character
 * could be written, and the token count now rides along with it.
 */
export async function createExport(request: ExportRequest): Promise<ExportStatistics> {
    const { entries, configuration, destination, signal, onProgress } = request;

    throwIfCancelled(signal);

    const notices = stubNotices(configuration);
    const measurements = await measureEntries(entries, signal, onProgress);

    const statistics: ExportStatistics = {
        entryCount: entries.length,
        embedCount: 0,
        stubCount: 0,
        characterCount: 0,
        tokenCount: 0,
        tokenThresholdExceeded: false
    };

    const tally = createTokenTally();
    const writer = createWriter(destination, statistics, tally);
    const { write } = writer;

    await write('# Project Code Export\n\n');
    await write('## File tree\n\n');

    // Inside a fence, and inside one widened past its own content for the same
    // reason a file's is: a name may contain backticks, and a tree that broke
    // the document it opens would be worse than no tree. The fence is also
    // what keeps the connectors from being read as prose to be reflowed.
    const tree = renderFileTree(entries, tokenCountsByPath(measurements));
    const treeFence = fenceOf(longestBacktickRunIn(tree));
    await write(`${treeFence}\n${tree}${treeFence}\n\n`);

    await write(`${approximationNotice}\n\n`);
    await write('---\n\n');

    let completed = 0;

    for (const entry of entries) {
        throwIfCancelled(signal);

        await write(`## ${entry.relativePath}\n\n`);

        if (entry.classification === 'stub') {
            statistics.stubCount += 1;
            await write(notices[entry.reason]);
        } else {
            statistics.embedCount += 1;
            await writeEmbeddedContent(entry, measurements.get(entry), notices, writer, signal);
        }

        await write('---\n\n');

        completed += 1;
        onProgress?.({
            phase: 'rendering',
            completed,
            total: entries.length,
            detail: entry.relativePath
        });
    }

    statistics.tokenCount = tally.total();
    statistics.tokenThresholdExceeded =
        configuration.tokenWarningThreshold > 0
        && statistics.tokenCount > configuration.tokenWarningThreshold;

    return statistics;
}

/**
 * How the Export reaches its Destination, and what is counted on the way.
 *
 * Two ways in, because a file's content is counted before the rendering
 * starts and counting it again on the way past would double the tokenizer's
 * work for a number already in hand. Everything else — headings, the tree,
 * fences, Stub notices — is counted as it is written, which is what makes the
 * total the whole Export's rather than only its files'.
 */
interface ExportWriter {
    /** Write part of the Export's own structure, counting it as it goes. */
    write(chunk: string): Promise<void>;
    /** Write part of a file's content, whose tokens are already counted. */
    writeContent(chunk: string): Promise<void>;
    /** Take the tokens of a file measured before the rendering began. */
    addMeasuredTokens(count: number): void;
}

function createWriter(
    destination: ExportDestination,
    statistics: ExportStatistics,
    tally: TokenTally
): ExportWriter {
    const emit = async (chunk: string): Promise<void> => {
        statistics.characterCount += chunk.length;
        await destination.write(chunk);
    };

    return {
        async write(chunk: string): Promise<void> {
            tally.add(chunk);
            await emit(chunk);
        },
        writeContent: emit,
        addMeasuredTokens(count: number): void {
            tally.addCounted(count);
        }
    };
}

/** The per-file counts the tree annotates its leaves with. */
function tokenCountsByPath(
    measurements: Map<ExpansionEntry, Measurement>
): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [entry, measurement] of measurements) {
        counts.set(entry.relativePath, measurement.tokenCount);
    }
    return counts;
}

/**
 * Read every embedded file once, before the Export opens, so that the tree at
 * its head can say what each file costs.
 *
 * A file that cannot be read is left out of the result rather than reported
 * here: the rendering below already knows how to say that a file's content is
 * missing, and it says it in the Stub vocabulary the rest of the Export uses.
 */
async function measureEntries(
    entries: ExpansionEntry[],
    signal: AbortSignal | undefined,
    onProgress: ProgressReporter | undefined
): Promise<Map<ExpansionEntry, Measurement>> {
    const measurements = new Map<ExpansionEntry, Measurement>();
    let completed = 0;

    for (const entry of entries) {
        throwIfCancelled(signal);

        if (entry.classification === 'embed') {
            const measurement = await measureFile(entry.absolutePath, signal);
            if (measurement) {
                measurements.set(entry, measurement);
            }
        }

        completed += 1;
        onProgress?.({
            phase: 'measuring',
            completed,
            total: entries.length,
            detail: entry.relativePath
        });
    }

    return measurements;
}

/**
 * Scan one file for the two things the Export has to know before it can write
 * a word of it, in a single read of its bytes.
 *
 * Backticks are counted on the decoded text rather than the raw bytes, which
 * is the same count: a backtick is ASCII, and no byte of a multi-byte UTF-8
 * sequence is ever below 0x80. A run straddling two chunks is counted as one,
 * since the count carries across the boundary.
 */
async function measureFile(
    absolutePath: string,
    signal: AbortSignal | undefined
): Promise<Measurement | undefined> {
    let handle: FileHandle;
    try {
        handle = await open(absolutePath, 'r');
    } catch {
        return undefined;
    }

    try {
        const buffer = Buffer.allocUnsafe(readChunkBytes);
        const decoder = new StringDecoder('utf8');
        const tally = createTokenTally();
        const run = { current: 0, longest: 0 };
        let position = 0;

        for (;;) {
            // Between chunks as well as between files, so that measuring a
            // single very large file can still be cancelled.
            throwIfCancelled(signal);

            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            if (bytesRead === 0) {
                break;
            }
            position += bytesRead;

            const text = decoder.write(buffer.subarray(0, bytesRead));
            countBacktickRuns(text, run);
            tally.add(text);
        }

        const trailing = decoder.end();
        countBacktickRuns(trailing, run);
        tally.add(trailing);

        return { fence: fenceOf(run.longest), tokenCount: tally.total() };
    } catch (error) {
        if (error instanceof ExportCancelled) {
            throw error;
        }
        // The file was there when the Expansion classified it and is not
        // readable now. The rendering says so in its own voice.
        return undefined;
    } finally {
        await handle.close();
    }
}

/**
 * Stream one file into its fence. The file is read in chunks and handed on as
 * it arrives, so neither the file nor the Export is ever held whole.
 *
 * Nothing here decides that a file should be a Stub — the Expansion settled
 * that. What is left is the file that was readable when it was classified and
 * is not readable now, which speaks with the same voice rather than inventing
 * a second vocabulary for the same fact.
 */
async function writeEmbeddedContent(
    entry: EmbeddedEntry,
    measurement: Measurement | undefined,
    notices: Record<StubReason, string>,
    writer: ExportWriter,
    signal?: AbortSignal
): Promise<void> {
    // No measurement means the file could not be read a moment ago, when the
    // fence it would need was being worked out.
    if (!measurement) {
        await writer.write(notices.unreadable);
        return;
    }

    let handle: FileHandle;
    try {
        handle = await open(entry.absolutePath, 'r');
    } catch {
        await writer.write(notices.unreadable);
        return;
    }

    try {
        const { fence } = measurement;

        await writer.write(`${fence}${languageHintFor(entry.absolutePath)}\n`);

        // A closing fence has to start its own line, and content that already
        // ends in a newline has given it one. Writing another unconditionally
        // is what put a blank line before every closing fence in the Export.
        let atLineStart = true;
        const writeContent = async (chunk: string): Promise<void> => {
            if (chunk.length > 0) {
                atLineStart = chunk.endsWith('\n');
            }
            await writer.writeContent(chunk);
        };

        let failed = false;
        try {
            await streamContent(handle, writeContent, signal);
        } catch (error) {
            if (error instanceof ExportCancelled) {
                throw error;
            }
            // The file was readable a moment ago, so it changed underneath the
            // Export. Close the block before saying so, rather than leaving a
            // fence open and corrupting everything after it.
            failed = true;
        }

        // The content went past uncounted, because measuring it is what
        // produced the number the tree already states.
        writer.addMeasuredTokens(measurement.tokenCount);

        await writer.write(`${atLineStart ? '' : '\n'}${fence}\n\n`);

        if (failed) {
            await writer.write(notices.unreadable);
        }
    } finally {
        await handle.close();
    }
}

/** The longest unbroken run of backticks, carrying a run in across chunks. */
function countBacktickRuns(text: string, run: { current: number; longest: number }): void {
    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === backtickByte) {
            run.current += 1;
            if (run.current > run.longest) {
                run.longest = run.current;
            }
        } else {
            run.current = 0;
        }
    }
}

/** The same count as countBacktickRuns, for text already held whole. */
function longestBacktickRunIn(text: string): number {
    const run = { current: 0, longest: 0 };
    countBacktickRuns(text, run);
    return run.longest;
}

/**
 * A fence one backtick longer than the longest run in the content it will
 * enclose, which is what makes corruption by an embedded fence impossible.
 */
function fenceOf(longestRun: number): string {
    return '`'.repeat(Math.max(minimumFenceLength, longestRun + 1));
}

/** Hand the file's decoded content to the Destination chunk by chunk. */
async function streamContent(
    handle: FileHandle,
    write: (chunk: string) => Promise<void>,
    signal?: AbortSignal
): Promise<void> {
    const buffer = Buffer.allocUnsafe(readChunkBytes);
    const decoder = new StringDecoder('utf8');
    let position = 0;

    for (;;) {
        // Between chunks as well as between entries, so that a single very
        // large file can still be cancelled.
        throwIfCancelled(signal);

        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) {
            break;
        }
        position += bytesRead;

        const text = decoder.write(buffer.subarray(0, bytesRead));
        if (text.length > 0) {
            await write(text);
        }
    }

    const trailing = decoder.end();
    if (trailing.length > 0) {
        await write(trailing);
    }
}
