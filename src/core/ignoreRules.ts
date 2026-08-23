import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import ignore from 'ignore';

/**
 * One source of Exclusion rules, written in `.gitignore` syntax, compiled and
 * answered from memory.
 *
 * The verdict is deliberately three-valued. A source that matched nothing has
 * said nothing, which is not the same as saying a path is wanted: it is what
 * lets a lower-precedence source be consulted next, and it is what makes both
 * git's nesting and the precedence between `.exportignore` and `.gitignore`
 * come out the way a reader expects.
 */
export type IgnoreVerdict = 'excluded' | 'included';

export interface IgnoreRules {
    /**
     * What these rules say about a path given relative to the directory they
     * govern, or undefined where no rule matched it.
     */
    decide(relativePath: string): IgnoreVerdict | undefined;
}

/** `.gitignore` syntax is written with forward slashes on every platform. */
function toPosix(relativePath: string): string {
    return path.sep === '/' ? relativePath : relativePath.split(path.sep).join('/');
}

/** Compile `.gitignore`-syntax patterns into rules that answer from memory. */
export function compileIgnoreRules(patterns: string | readonly string[]): IgnoreRules {
    const compiled = ignore().add(Array.isArray(patterns) ? [...patterns] : patterns as string);

    return {
        decide(relativePath: string): IgnoreVerdict | undefined {
            const candidate = toPosix(relativePath);

            // Nothing outside the directory these rules govern is theirs to
            // judge, and the `ignore` package refuses such a path outright.
            if (candidate === '' || candidate.startsWith('..')) {
                return undefined;
            }

            const result = compiled.test(candidate);
            if (result.ignored) {
                return 'excluded';
            }
            if (result.unignored) {
                return 'included';
            }
            return undefined;
        }
    };
}

/**
 * Read one file of Exclusion rules, or report that there is none.
 *
 * Read once per Export by whoever owns the source, never once per file: this
 * is the read that used to happen inside the walker's innermost loop.
 */
export async function readIgnoreRules(filePath: string): Promise<IgnoreRules | undefined> {
    let content: string;
    try {
        content = await readFile(filePath, 'utf8');
    } catch {
        return undefined;
    }
    return compileIgnoreRules(content);
}
