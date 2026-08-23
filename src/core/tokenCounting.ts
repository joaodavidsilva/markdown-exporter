import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';

/**
 * The BPE vocabulary the counts are taken from, named in the Export so the
 * number can be read for what it is.
 *
 * A character heuristic was rejected: the point of the count is to predict
 * whether an Export fits a context window, and `characters / 4` is out by
 * about 12% on TypeScript, 34% on Portuguese prose and 65% on Japanese —
 * enough to defeat the prediction it exists to make.
 *
 * Of the real vocabularies, `o200k_base` was chosen over `cl100k_base`
 * because the people pasting an Export paste it into several model families,
 * and every current one uses a vocabulary of this size. On ASCII source the
 * two agree to within 0.2%, but on anything else `cl100k_base` overcounts
 * badly — 16% on Portuguese, 41% on Japanese — which would make the warning
 * fire on Exports that fit.
 */
export const tokenVocabulary = 'o200k_base';

/**
 * A file that contains the literal text `<|endoftext|>` is a file, not a
 * prompt. Left at its default the tokenizer throws on it, which would cost
 * the whole Export for the sake of a string that appears in any repository
 * that talks about tokenizers.
 */
const asOrdinaryText = { disallowedSpecial: new Set<string>() };

/**
 * The most text handed to the tokenizer at once.
 *
 * BPE merging is superlinear in the length of a single unbroken word, and a
 * file can hold one: 64 KB of unbroken characters takes about 1.9 seconds to
 * merge, and 256 KB takes thirty. Cutting at this length bounds that, at a
 * cost measured at 3 tokens in 1,083,140 — 0.0003% — on five megabytes of
 * TypeScript, which the count is already approximate enough to absorb.
 */
const maxUnitChars = 4096;

/**
 * A running token count over text that arrives in pieces.
 *
 * The Export is streamed, so nothing ever holds the finished document to
 * count it afterwards. What is held instead is at most one unit of text: the
 * tally counts and discards as the Export goes past.
 */
export interface TokenTally {
    /** Count a chunk of the Export as it is written. */
    add(text: string): void;
    /**
     * Add tokens already counted elsewhere — a file measured before the
     * rendering began, so that its content is tokenized once and not twice.
     */
    addCounted(tokens: number): void;
    /** Count whatever is left over, and report the total. */
    total(): number;
}

export function createTokenTally(): TokenTally {
    let pending = '';
    let counted = 0;

    const drain = (toTheEnd: boolean): void => {
        while (pending.length >= maxUnitChars || (toTheEnd && pending.length > 0)) {
            const cut = cutPoint(pending, toTheEnd);
            counted += countTokens(pending.slice(0, cut), asOrdinaryText);
            pending = pending.slice(cut);
        }
    };

    return {
        add(text: string): void {
            if (text.length > 0) {
                pending += text;
                drain(false);
            }
        },
        addCounted(tokens: number): void {
            counted += tokens;
        },
        total(): number {
            drain(true);
            return counted;
        }
    };
}

/**
 * Where to cut the pending text so the tokenizer gets a whole unit.
 *
 * A line break is the boundary the tokenizer would have used anyway, so
 * cutting there costs nothing at all. Without one — a minified bundle, a
 * base64 blob — the cut is made at the limit regardless, because a bounded
 * approximation beats an exact count nobody waits for.
 */
function cutPoint(text: string, toTheEnd: boolean): number {
    if (toTheEnd && text.length <= maxUnitChars) {
        return text.length;
    }

    const limit = Math.min(text.length, maxUnitChars);
    const newline = text.lastIndexOf('\n', limit - 1);
    const cut = newline >= 0 ? newline + 1 : limit;

    // A cut between the halves of a surrogate pair would hand the tokenizer
    // half a character and take the other half as the start of the next unit.
    if (cut < text.length && isLowSurrogate(text.charCodeAt(cut))) {
        return cut + 1;
    }

    return cut;
}

function isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * How a token count is said, wherever it is said.
 *
 * The tilde is the whole point: model families tokenize differently, so the
 * number is a guide and not a contract, and it has to look like one at every
 * place it appears rather than only where there was room to explain.
 */
export function approximateTokens(count: number): string {
    return `~${groupDigits(count)} ${count === 1 ? 'token' : 'tokens'}`;
}

/** Thousands separated, without depending on the host's locale data. */
export function groupDigits(count: number): string {
    return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
