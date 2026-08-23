import * as path from 'node:path';
import { IgnoreRules, IgnoreVerdict, readIgnoreRules } from './ignoreRules';

const gitignoreName = '.gitignore';

/**
 * Every `.gitignore` from the workspace root down to a file's own directory,
 * applied with git's semantics.
 *
 * Only the root one used to be read, which is not how git behaves: a
 * `.gitignore` governs its own directory and everything beneath it, its
 * patterns are relative to where it sits, and the deepest file with something
 * to say wins — which is what lets a nested `!rule` re-include what a shallower
 * file excluded.
 */
export interface GitignoreChain {
    /**
     * Read the `.gitignore` files governing this directory and its ancestors,
     * so that `decide` can answer for anything inside it without touching the
     * filesystem. Each file is read at most once per Export.
     *
     * The walk passes the directory's own listing when it already has one,
     * which is how a workspace of a thousand directories with one `.gitignore`
     * costs exactly one read rather than a thousand failed ones.
     */
    enter(directoryPath: string, entryNames?: readonly string[]): Promise<void>;
    /** git's verdict for a path, or undefined where no rule matched it. */
    decide(absolutePath: string): IgnoreVerdict | undefined;
}

export function createGitignoreChain(workspaceRoot: string): GitignoreChain {
    /** One entry per directory entered; undefined where it has no `.gitignore`. */
    const layers = new Map<string, IgnoreRules | undefined>();

    /** The workspace root, then each directory down to this one. */
    const chainTo = (directoryPath: string): string[] => {
        const relative = path.relative(workspaceRoot, directoryPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return [];
        }

        const directories = [workspaceRoot];
        let current = workspaceRoot;
        for (const segment of relative === '' ? [] : relative.split(path.sep)) {
            current = path.join(current, segment);
            directories.push(current);
        }
        return directories;
    };

    return {
        async enter(directoryPath: string, entryNames?: readonly string[]): Promise<void> {
            for (const directory of chainTo(directoryPath)) {
                if (layers.has(directory)) {
                    continue;
                }

                // A listing is proof: it says whether the file is there
                // without a read that would only have failed.
                if (entryNames && directory === directoryPath && !entryNames.includes(gitignoreName)) {
                    layers.set(directory, undefined);
                    continue;
                }

                layers.set(directory, await readIgnoreRules(path.join(directory, gitignoreName)));
            }
        },

        decide(absolutePath: string): IgnoreVerdict | undefined {
            const relative = path.relative(workspaceRoot, absolutePath);
            if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
                return undefined;
            }

            // Deepest first: the `.gitignore` closest to the file is the one
            // whose author knew most about it, and the first with an opinion
            // settles the matter.
            const directories = chainTo(path.dirname(absolutePath));
            for (let index = directories.length - 1; index >= 0; index -= 1) {
                const rules = layers.get(directories[index]);
                if (!rules) {
                    continue;
                }
                const verdict = rules.decide(path.relative(directories[index], absolutePath));
                if (verdict) {
                    return verdict;
                }
            }

            return undefined;
        }
    };
}
