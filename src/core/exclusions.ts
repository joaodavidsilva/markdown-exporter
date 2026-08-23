import * as path from 'node:path';
import { ResolvedConfiguration } from './configuration';
import { createGitignoreChain } from './gitignore';
import { IgnoreVerdict, readIgnoreRules } from './ignoreRules';

/**
 * Directory names no Expansion ever walks into. This suppression is built in
 * and deliberately not configurable: `.gitignore` never lists itself, so
 * without it every Export of a repository with history spends most of its time
 * on objects nobody would ever export.
 */
const suppressedDirectoryNames = new Set(['.git']);

/**
 * Exclusion rules that live in the repository rather than in the editor's
 * settings, so that everybody exporting the project gets the same ones.
 */
const exportIgnoreName = '.exportignore';

/** Whether the built-in suppression removes this path, or anything above it. */
function isSuppressed(relativePath: string): boolean {
    return relativePath
        .split(path.sep)
        .some(segment => suppressedDirectoryNames.has(segment));
}

/**
 * The Exclusion rules of one Export, already read from disk and compiled.
 *
 * Deciding an Exclusion must not touch the filesystem: the sources are read
 * once per Export — the root ones by `compileExclusions`, and each nested
 * `.gitignore` by `enter` the moment the walk first reaches its directory —
 * and every path is then answered from memory. Reading them per file is what
 * made Export time grow with the square of the repository size.
 */
export interface CompiledExclusions {
    /** Whether an Exclusion removes this path from the Expansion. */
    excludes(absolutePath: string): boolean;
    /**
     * Whether this path is removed by the tool's own authority rather than by
     * any rule the user wrote: the `.git` directory, and the Exports this
     * extension writes itself.
     *
     * Kept apart from `excludes` because the two answer to different
     * authorities. These cannot be configured off and are not overridden by
     * picking the path in the explorer, while every other source is the user's
     * and picking a path outright beats all of them.
     */
    suppresses(absolutePath: string): boolean;
    /**
     * Read the sources that govern a directory the walk is about to read,
     * given its listing. Every path beneath it is then answered from memory.
     */
    enter(directoryPath: string, entryNames?: readonly string[]): Promise<void>;
}

/**
 * Read every Exclusion source once and compile them into a single decision.
 *
 * The in-flight Export's own file travels in as `exportFileName` rather than
 * living in module state, so an Export never contains a previous one and two
 * Exports cannot collide.
 */
export async function compileExclusions(
    workspaceRoot: string,
    configuration: ResolvedConfiguration,
    exportFileName?: string
): Promise<CompiledExclusions> {
    const gitignore = createGitignoreChain(workspaceRoot);
    const exportIgnore = await readIgnoreRules(path.join(workspaceRoot, exportIgnoreName));

    const additionalIgnore = new Set(configuration.additionalIgnore);
    const outputFilePath = path.join(workspaceRoot, configuration.outputFile);
    const exportFilePath = exportFileName
        ? path.join(workspaceRoot, exportFileName)
        : undefined;

    /** A file this extension wrote, or is about to write, as an Export. */
    const isOwnExport = (absolutePath: string): boolean => {
        if (absolutePath === outputFilePath) {
            return true;
        }
        return exportFilePath !== undefined && absolutePath === exportFilePath;
    };

    const suppresses = (absolutePath: string): boolean => {
        const relativePath = path.relative(workspaceRoot, absolutePath);
        if (relativePath === '') {
            return false;
        }
        return isSuppressed(relativePath) || isOwnExport(absolutePath);
    };

    /**
     * What the user's own sources say, in decreasing precedence. The first one
     * with an opinion settles the matter — which is how `.exportignore` beats
     * `.gitignore` in both directions: it can exclude what git kept, and its
     * negations can keep what git excluded.
     */
    const decide = (absolutePath: string, relativePath: string): IgnoreVerdict | undefined => {
        if (additionalIgnore.has(relativePath)) {
            return 'excluded';
        }

        const exportIgnored = exportIgnore?.decide(relativePath);
        if (exportIgnored) {
            return exportIgnored;
        }

        return gitignore.decide(absolutePath);
    };

    return {
        suppresses,

        enter(directoryPath: string, entryNames?: readonly string[]): Promise<void> {
            return gitignore.enter(directoryPath, entryNames);
        },

        excludes(absolutePath: string): boolean {
            const relativePath = path.relative(workspaceRoot, absolutePath);

            // The workspace root itself is the ground the rules are relative
            // to, never a candidate for Exclusion.
            if (relativePath === '') {
                return false;
            }

            if (suppresses(absolutePath)) {
                return true;
            }

            return decide(absolutePath, relativePath) === 'excluded';
        }
    };
}
