import * as path from 'node:path';
import { ResolvedConfiguration } from './configuration';

/**
 * Masking a secret value inside an embedded file's content while the rest of
 * the file is still embedded — distinct from a Stub, where the whole file's
 * content is omitted (CONTEXT.md). Two mechanisms, applied in this file:
 *
 * - Whole-file treatment for `.env` and its variants: every assignment's
 *   value is replaced and its key is kept, so the Export still shows what
 *   configuration exists without showing what it is set to.
 * - Pattern matching for the recognisable shapes of common credentials,
 *   inside *any* embedded file — not only `.env` ones, and also run over an
 *   `.env` file's own comments and malformed lines, which the whole-value
 *   masking does not otherwise reach.
 *
 * Redaction is explicitly best-effort (README): it catches known shapes, not
 * every secret a file might contain. What it replaces a match with always
 * says what was removed — `[REDACTED: <what>]` — rather than vanishing into
 * an empty string a reader has no way to notice.
 */
export interface RedactionOutcome {
    /** The text with every match replaced by a marker that names it. */
    text: string;
    /** How many spans were replaced. */
    count: number;
}

const noRedaction = (text: string): RedactionOutcome => ({ text, count: 0 });

/**
 * Redact one embedded file's decoded content, deciding by its path which of
 * the two mechanisms applies.
 *
 * This is the only entry point export.ts calls. Where in the pipeline it
 * runs, and why that has to be before token counting, is decided there — this
 * module only knows how to turn text into Redacted text, not when.
 */
export function redactFileContent(
    text: string,
    relativePath: string,
    configuration: ResolvedConfiguration
): RedactionOutcome {
    if (!configuration.redactionEnabled) {
        return noRedaction(text);
    }
    return isEnvFileName(relativePath) ? redactEnvFile(text) : redactCredentialPatterns(text);
}

/**
 * Whether a path names a dotenv file: `.env` itself, or a variant named after
 * it — `.env.local`, `.env.production`, `.env.test`, `.env.example` and the
 * rest of the family a deployment invents a suffix for.
 *
 * Matched by name only, exactly like the Expansion's own Stub classification
 * (binaryFiles, binaryFileExtensions) and languages.ts's dotenv language
 * hint: cheap, and it costs no read to decide. Lower-cased first, the same
 * way languageForFileName is, so a `.ENV` some tool wrote on a case-preserving
 * filesystem is still recognised — the dotenv convention itself is always
 * written lower-case, but the file on disk is not obliged to be.
 *
 * A deliberately fake fixture — `.env.example` included — is still masked by
 * default. The escape hatch for that case is the setting that turns
 * Redaction off entirely, not a filename this function is trusted to
 * recognise as harmless.
 */
function isEnvFileName(relativePath: string): boolean {
    const name = path.basename(relativePath).toLowerCase();
    return name === '.env' || name.startsWith('.env.');
}

/**
 * One assignment line of a dotenv file: optional leading whitespace, an
 * optional `export `, the key, `=`, and everything after it as the value.
 *
 * No nested or overlapping quantifiers — every piece is a fixed literal or a
 * single quantified character class — so matching never backtracks, whatever
 * the line contains. Applied one line at a time (`redactEnvFile` below), so
 * even a pathological line only ever costs work proportional to its own
 * length, never the whole file's.
 */
const envAssignmentPattern = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;

/**
 * Mask the value of every assignment line in a dotenv file's text, keeping
 * its key.
 *
 * Text is split on line endings with the separators kept (the capturing group
 * in the split regex), so whichever ending the file used — `\n`, `\r\n`, a
 * lone `\r` — is reproduced exactly rather than normalised to one of them.
 * Comments, blank lines and anything else that is not a plain assignment are
 * left untouched here; `redactFileContent` still runs the pattern sweep over
 * the result, which is what catches a stray credential sitting in a comment.
 */
function maskEnvAssignments(text: string): RedactionOutcome {
    const segments = text.split(/(\r\n|\r|\n)/);
    let count = 0;

    for (let index = 0; index < segments.length; index += 2) {
        const match = envAssignmentPattern.exec(segments[index]);
        if (!match) {
            continue;
        }

        const [, leading, key, equals, value] = match;

        // An empty, or whitespace-only, value has nothing in it to Redact.
        // Marking it anyway would claim a secret was there when the line
        // never carried one.
        if (value.trim().length === 0) {
            continue;
        }

        segments[index] = `${leading}${key}${equals}${maskValue(value)}`;
        count += 1;
    }

    return { text: segments.join(''), count };
}

/**
 * Replace one assignment's value, keeping a wrapping quote pair if the value
 * had one — so `KEY="secret"` reads as `KEY="[REDACTED: value]"` rather than
 * losing the quoting the file chose. An unmatched or absent quote is left
 * alone; the value itself, quoted or not, always becomes the marker.
 */
function maskValue(rawValue: string): string {
    const trimmed = rawValue.trim();
    const first = trimmed.charAt(0);
    const last = trimmed.charAt(trimmed.length - 1);

    if (trimmed.length >= 2 && (first === '"' || first === '\'') && last === first) {
        return `${first}[REDACTED: value]${first}`;
    }
    return '[REDACTED: value]';
}

/**
 * The whole-file mechanism for a dotenv variant: mask every assignment's
 * value, then run the ordinary pattern sweep over what is left — the
 * comments and malformed lines the line-based mask does not touch — so a key
 * pasted into a `# TODO: rotate sk-...` comment is still caught.
 */
function redactEnvFile(text: string): RedactionOutcome {
    const masked = maskEnvAssignments(text);
    const swept = redactCredentialPatterns(masked.text);
    return { text: swept.text, count: masked.count + swept.count };
}

/**
 * One recognisable credential shape: a name to report it by, and how to turn
 * one match into its replacement. Most patterns need no `replacement` of
 * their own and fall back to replacing the whole match with
 * `[REDACTED: name]`; the database-URL pattern overrides it to keep the
 * scheme, host and user visible and Redact only the password, which is the
 * only part of that match that is actually a secret.
 */
interface CredentialPattern {
    name: string;
    pattern: RegExp;
    replacement?: (match: string, ...groups: string[]) => string;
}

const marker = (name: string): string => `[REDACTED: ${name}]`;

/**
 * The credential shapes this Export recognises, and why each one is on the
 * list.
 *
 * Chosen for being both common in the wild and structurally distinctive
 * enough that matching one is rarely a coincidence: every pattern here keys
 * off a fixed prefix (or, for the JWT and the database URL, a fixed shape) a
 * real secret from that provider always carries, rather than guessing from
 * general shape alone. This is deliberately not exhaustive — best-effort
 * means known shapes, not every secret — and it is documented as such in the
 * README.
 *
 * Every quantifier below is a single bounded repetition of a plain character
 * class (`{16}`, `{20,150}`, and so on) applied directly, never nested inside
 * another quantifier or an ambiguous alternation. That is what makes
 * matching linear in the length of the text regardless of what the text
 * contains: there is only ever one way to extend or fail a match at a given
 * position, so there is nothing for the engine to backtrack over. Measured
 * over adversarial multi-megabyte input built to be a near-miss for every
 * pattern at once — see the "does not stall on an adversarial file" test —
 * the whole sweep finishes in well under a tenth of a second.
 *
 * Upper bounds (`{...,150}`, `{...,250}`) exist for the same reason a lower
 * bound does: a real key is never a megabyte long, and capping how far a
 * failed match is allowed to scan keeps the worst case fast even when a file
 * is built specifically to make every position a near-miss.
 *
 * Anthropic is listed, and matched, ahead of OpenAI: an Anthropic key also
 * satisfies the OpenAI pattern's `sk-` prefix, and the negative lookahead on
 * the OpenAI pattern (`(?!ant-)`) is what keeps an Anthropic key from being
 * reported as the wrong provider even if this order is ever changed.
 */
const credentialPatterns: CredentialPattern[] = [
    {
        name: 'Anthropic API key',
        pattern: /\bsk-ant-[A-Za-z0-9_-]{20,150}\b/g
    },
    {
        // OpenAI's classic and project-scoped keys both start "sk-" and
        // are not otherwise distinguished; one label covers both.
        name: 'OpenAI API key',
        pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,150}\b/g
    },
    {
        // ghp_ (personal), gho_ (OAuth), ghu_ / ghs_ (GitHub App), ghr_
        // (refresh) — classic tokens are a fixed 40 characters total; the
        // upper bound is headroom, not a claim about the exact length.
        name: 'GitHub token',
        pattern: /\bgh[oprsu]_[A-Za-z0-9]{36,150}\b/g
    },
    {
        name: 'GitHub token',
        pattern: /\bgithub_pat_[A-Za-z0-9_]{20,150}\b/g
    },
    {
        // Publishable keys (pk_) are not secret by Stripe's own design, but
        // are Redacted alongside secret and restricted keys anyway: telling
        // them apart from here would need to trust the text's own claim
        // about itself, and a best-effort scan should not spend that trust.
        name: 'Stripe key',
        pattern: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,150}\b/g
    },
    {
        // AKIA: long-term access key. ASIA: temporary (STS) access key.
        // Both are exactly 20 characters and never appear without one of
        // these two prefixes.
        name: 'AWS access key',
        pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g
    },
    {
        // A JWT's header is near-always the base64url of a JSON object
        // starting `{"`, which encodes to the literal characters "eyJ" —
        // the same heuristic widely used to spot one on sight.
        name: 'JWT',
        pattern: /\beyJ[A-Za-z0-9_-]{10,250}\.[A-Za-z0-9_-]{10,250}\.[A-Za-z0-9_-]{10,250}\b/g
    },
    {
        // scheme://user:password@ — only the password is a secret, so only
        // the password is Redacted; the scheme, user and host stay legible.
        // Restricted to schemes a password-bearing connection string
        // actually uses, so an ordinary https:// URL is never a candidate.
        name: 'database password',
        pattern: /\b(postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/([^:/\s@]+):([^@/\s]+)@/g,
        replacement: (_match, scheme: string, user: string) => `${scheme}://${user}:${marker('database password')}@`
    }
];

/**
 * Sweep every credential pattern over one piece of text, in sequence.
 *
 * Sequential rather than one combined pass: each pattern's replacer needs its
 * own reconstruction (most emit a plain marker, the database-URL one keeps
 * the user and host either side of it), which a single alternation could not
 * express, and a later pattern only ever sees the previous one's output —
 * never the original secret twice — because a replaced span reads as literal
 * marker text, and no marker resembles any pattern here closely enough to be
 * matched again by mistake.
 *
 * Built on `exec` in a manual loop rather than `String.replace`, because a
 * replacer function passed to `replace` is handed the match's offset and the
 * whole original string as trailing arguments alongside the captured groups
 * — both strings or string-shaped enough to be indistinguishable from a
 * group by position alone. Reading `match.slice(1)` off the result of `exec`
 * is the capture groups and nothing else.
 */
export function redactCredentialPatterns(text: string): RedactionOutcome {
    let current = text;
    let count = 0;

    for (const { name, pattern, replacement } of credentialPatterns) {
        const replace = replacement ?? ((): string => marker(name));
        let matched = 0;
        let rebuilt = '';
        let position = 0;
        pattern.lastIndex = 0;

        for (let found = pattern.exec(current); found !== null; found = pattern.exec(current)) {
            rebuilt += current.slice(position, found.index);
            rebuilt += replace(found[0], ...found.slice(1));
            position = found.index + found[0].length;
            matched += 1;

            // None of the patterns above can match zero-length text, but
            // nothing stops that from staying true only by construction —
            // this is what turns a future change that breaks it into a
            // one-match-short-of-infinite loop instead of an infinite one.
            if (found[0].length === 0) {
                pattern.lastIndex += 1;
            }
        }

        rebuilt += current.slice(position);
        current = rebuilt;
        count += matched;
    }

    return { text: current, count };
}
