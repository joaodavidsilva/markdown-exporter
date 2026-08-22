import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import ignore from 'ignore';

/** Decides whether an Exclusion rule removes a path from the Expansion. */
export type ExclusionFilter = (filePath: string) => boolean;

/**
 * Compile the workspace's root `.gitignore` into an Exclusion filter. A
 * workspace without one excludes nothing.
 */
export async function createGitignoreFilter(workspaceRoot: string): Promise<ExclusionFilter> {
    const gitignorePath = path.join(workspaceRoot, '.gitignore');

    let gitignoreContent: string;
    try {
        gitignoreContent = await readFile(gitignorePath, 'utf8');
    } catch {
        return () => false;
    }

    const ig = ignore().add(gitignoreContent);

    return (filePath: string) => {
        const relativePath = path.relative(workspaceRoot, filePath);
        return ig.ignores(relativePath);
    };
}
