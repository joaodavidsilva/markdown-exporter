import * as path from 'node:path';
import { ResolvedConfiguration } from './configuration';
import { createGitignoreChain } from './gitignore';

/**
 * Directory names no Expansion ever walks into. This suppression is built in
 * and deliberately not configurable: `.gitignore` never lists itself, so
 * without it every Export of a repository with history spends most of its time
 * on objects nobody would ever export.
 */
const suppressedDirectoryNames = new Set(['.git']);

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
 * once per Export — `enter` reads each `.gitignore` the moment the walk first
 * needs it and never again — and every path is then answered from memory.
 * Reading them per file is what made Export time grow with the square of the
 * repository size.
 */
export interface CompiledExclusions {
    /** Whether an Exclusion removes this path from the Expansion. */
    excludes(absolutePath: string): boolean;
    /**
     * Whether the built-in suppression alone removes this path, with no
     * configurable source consulted. Kept apart from `excludes` because the
     * two answer to different authorities: the suppression is the tool's own
     * and cannot be turned off, while every other source is the user's.
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

    const additionalIgnore = new Set(configuration.additionalIgnore);
    const outputFilePath = path.join(workspaceRoot, configuration.outputFile);
    const exportFilePath = exportFileName
        ? path.join(workspaceRoot, exportFileName)
        : undefined;

    const suppresses = (absolutePath: string): boolean => {
        const relativePath = path.relative(workspaceRoot, absolutePath);
        return relativePath !== '' && isSuppressed(relativePath);
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

            if (gitignore.decide(absolutePath) === 'excluded') {
                return true;
            }

            if (additionalIgnore.has(relativePath)) {
                return true;
            }

            if (absolutePath === outputFilePath) {
                return true;
            }

            if (exportFilePath && absolutePath === exportFilePath) {
                return true;
            }

            return false;
        }
    };
}
