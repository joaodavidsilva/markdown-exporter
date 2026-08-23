import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { ExportCancelled, throwIfCancelled } from './cancellation';
import { ResolvedConfiguration } from './configuration';
import { ExportDestination } from './destinations';
import { EmbeddedEntry, ExpansionEntry, StubReason } from './expansion';
import { renderFileTree } from './fileTree';
import { languageHintFor } from './languages';
import { ProgressReporter } from './progress';
import { redactFileContent } from './redaction';
import { createTokenTally, isLowSurrogate, TokenTally, tokenVocabulary } from './tokenCounting';

/**
 * How much of a file is read from disk at a time, and how large a piece of
 * its (Redacted) text is handed to a Destination at a time.
 *
 * These no longer bound how much of one file's text is held at once — see
 * `readDecodedFile` — only how big the steps are on the way in and on the
 * way out, which is what keeps a huge file's read and its write each
 * interruptible rather than one uncancellable operation apiece.
 */
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
    /**
     * How many secret-shaped spans were Redacted across the whole Export —
     * reported in the same spirit as tokenCount: a fact the reader could not
     * otherwise see without opening every file themselves. Zero either means
     * the Selection held nothing recognisable, or that Redaction was turned
     * off; the summary that reports this number says which (adapter concern,
     * not this seam's).
     */
    redactionCount: number;
}

/**
 * What was learnt about one embedded file before a character of the Export
 * was written: how long its fence has to be, how many tokens its (Redacted)
 * content is worth, and how many Redactions it took to get there.
 */
interface Measurement {
    fence: string;
    tokenCount: number;
    redactionCount: number;
}

/**
 * The second seam. Renders an Expansion into an Export, handing it to the
 * Destination as it goes rather than assembling the whole document first.
 *
 * The rendering happens in two passes over the *files*, never over the
 * document: the Export itself is written once, streamed out, and never held.
 * The first pass measures each embedded file — Redacting it, then taking the
 * longest run of backticks in the result, which the fence has to clear, and
 * its token count, which the tree has to state — and the second writes the
 * Export. Redaction has to come before both: it changes the text, and the
 * fence and the token count have to answer for what the Export actually
 * says, not for the secret that was read off disk and is never written
 * anywhere. That ordering is also what keeps the token count honest — a
 * count taken before Redaction would overstate what the reader's model
 * actually has to pay for, since a marker is shorter than the secret it
 * replaced.
 */
export async function createExport(request: ExportRequest): Promise<ExportStatistics> {
    const { entries, configuration, destination, signal, onProgress } = request;

    throwIfCancelled(signal);

    const notices = stubNotices(configuration);
    const measurements = await measureEntries(entries, configuration, signal, onProgress);

    const statistics: ExportStatistics = {
        entryCount: entries.length,
        embedCount: 0,
        stubCount: 0,
        characterCount: 0,
        tokenCount: 0,
        tokenThresholdExceeded: false,
        redactionCount: 0
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
            const measurement = measurements.get(entry);
            statistics.redactionCount += measurement?.redactionCount ?? 0;
            await writeEmbeddedContent(entry, measurement, notices, writer, configuration, signal);
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
    configuration: ResolvedConfiguration,
    signal: AbortSignal | undefined,
    onProgress: ProgressReporter | undefined
): Promise<Map<ExpansionEntry, Measurement>> {
    const measurements = new Map<ExpansionEntry, Measurement>();
    let completed = 0;

    for (const entry of entries) {
        throwIfCancelled(signal);

        if (entry.classification === 'embed') {
            const measurement = await measureFile(
                entry.absolutePath,
                entry.relativePath,
                configuration,
                signal
            );
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
 * Read one file whole, decoded as UTF-8.
 *
 * Bounded by the size of this one file — the same bound that already decides
 * whether it is embedded at all, since a file past it is a Stub before this
 * function is ever called — and never by the Export, which is never
 * assembled or held as a single string. Reading still happens in bounded
 * disk reads with a cancellation check between each one, so a single very
 * large file stays interruptible; what changes is that the decoded pieces
 * are collected rather than acted on as they arrive, because Redaction
 * cannot safely judge a fixed-size slice of bytes on its own — a credential,
 * or an `.env` line, can straddle whatever boundary a read size happens to
 * land on.
 */
async function readDecodedFile(
    absolutePath: string,
    signal: AbortSignal | undefined
): Promise<string> {
    const handle = await open(absolutePath, 'r');
    try {
        const buffer = Buffer.allocUnsafe(readChunkBytes);
        const decoder = new StringDecoder('utf8');
        const parts: string[] = [];
        let position = 0;

        for (;;) {
            // Between chunks as well as between files, so that reading a
            // single very large file can still be cancelled.
            throwIfCancelled(signal);

            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            if (bytesRead === 0) {
                break;
            }
            position += bytesRead;
            parts.push(decoder.write(buffer.subarray(0, bytesRead)));
        }

        parts.push(decoder.end());
        return parts.join('');
    } finally {
        await handle.close();
    }
}

/**
 * Scan one file for everything the Export has to know before it can write a
 * word of it: how many spans Redaction has to replace, how long the fence
 * has to be, and how many tokens the content is worth — in that order,
 * because Redaction changes the text and the other two have to answer for
 * what the Export will actually contain, not for the secret that was read
 * off disk.
 *
 * Backticks are counted, and tokens tallied, on the whole Redacted text
 * rather than in pieces, which is what a run or a credential straddling an
 * arbitrary boundary needs — see readDecodedFile.
 */
async function measureFile(
    absolutePath: string,
    relativePath: string,
    configuration: ResolvedConfiguration,
    signal: AbortSignal | undefined
): Promise<Measurement | undefined> {
    let text: string;
    try {
        text = await readDecodedFile(absolutePath, signal);
    } catch (error) {
        if (error instanceof ExportCancelled) {
            throw error;
        }
        // The file was there when the Expansion classified it and is not
        // readable now. The rendering says so in its own voice.
        return undefined;
    }

    const { text: redacted, count: redactionCount } = redactFileContent(
        text,
        relativePath,
        configuration
    );

    const run = { current: 0, longest: 0 };
    countBacktickRuns(redacted, run);

    const tally = createTokenTally();
    tally.add(redacted);

    return { fence: fenceOf(run.longest), tokenCount: tally.total(), redactionCount };
}

/**
 * Write one embedded file's Redacted content into its fence.
 *
 * The file is read and Redacted again here rather than reusing the text
 * `measureFile` already produced: holding every embedded file's Redacted
 * text between the two passes would hold the whole Export in memory at
 * once, which is exactly what rendering in two passes over the *files* —
 * rather than once over the document — exists to avoid. Redaction is a pure
 * function of one file's content and its path, so measuring it twice costs a
 * second read and a second sweep of the same patterns, and produces the same
 * text and the same count both times by construction, not by coordination
 * between the two passes.
 *
 * Because the whole file is read and Redacted before any of it is written,
 * there is no longer a state where the fence has been opened and the read
 * then fails partway: either the read succeeds and the fence opens, is
 * filled and is closed, or it fails up front and only the Stub vocabulary's
 * unreadable notice is written — the same notice, and the same shape, as a
 * file that was already gone when `measureFile` tried it.
 */
async function writeEmbeddedContent(
    entry: EmbeddedEntry,
    measurement: Measurement | undefined,
    notices: Record<StubReason, string>,
    writer: ExportWriter,
    configuration: ResolvedConfiguration,
    signal: AbortSignal | undefined
): Promise<void> {
    // No measurement means the file could not be read a moment ago, when the
    // fence it would need was being worked out.
    if (!measurement) {
        await writer.write(notices.unreadable);
        return;
    }

    let text: string;
    try {
        text = await readDecodedFile(entry.absolutePath, signal);
    } catch (error) {
        if (error instanceof ExportCancelled) {
            throw error;
        }
        // The file was readable a moment ago, so it changed underneath the
        // Export. It speaks with the same voice a Stub for the same reason
        // would have, rather than inventing a second vocabulary for the same
        // fact.
        await writer.write(notices.unreadable);
        return;
    }

    const { fence } = measurement;
    const { text: redacted } = redactFileContent(text, entry.relativePath, configuration);

    await writer.write(`${fence}${languageHintFor(entry.absolutePath)}\n`);
    await writeInSlices(redacted, writer.writeContent, signal);

    // The content went past uncounted, because measuring it is what
    // produced the number the tree already states.
    writer.addMeasuredTokens(measurement.tokenCount);

    // A closing fence has to start its own line, and content that already
    // ends in a newline has given it one; an empty file has none to close.
    const atLineStart = redacted.length === 0 || redacted.endsWith('\n');
    await writer.write(`${atLineStart ? '' : '\n'}${fence}\n\n`);
}

/** The longest unbroken run of backticks, carrying a run in across chunks. */
export function countBacktickRuns(text: string, run: { current: number; longest: number }): void {
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
export function fenceOf(longestRun: number): string {
    return '`'.repeat(Math.max(minimumFenceLength, longestRun + 1));
}

/**
 * Hand Redacted text to the Destination in bounded pieces, so a huge file
 * cannot hold up cancellation until its last byte and cannot be written to a
 * slow Destination as one giant chunk.
 *
 * A slice is never cut between the two halves of a surrogate pair: each
 * slice reaches a file Destination through its own `utf8`-encoding write
 * call, and splitting a pair between two such calls turns the one character
 * either half belongs to into two replacement characters instead — the same
 * hazard tokenCounting's cutPoint exists to avoid, and the same fix.
 */
async function writeInSlices(
    text: string,
    writeContent: (chunk: string) => Promise<void>,
    signal: AbortSignal | undefined
): Promise<void> {
    let start = 0;

    while (start < text.length) {
        throwIfCancelled(signal);

        let end = Math.min(text.length, start + readChunkBytes);
        if (end < text.length && isLowSurrogate(text.charCodeAt(end))) {
            end += 1;
        }

        await writeContent(text.slice(start, end));
        start = end;
    }
}
