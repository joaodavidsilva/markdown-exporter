import * as path from 'node:path';
import { isBinaryFile } from './binaryDetection';
import { ResolvedConfiguration } from './configuration';
import { createGitignoreFilter } from './gitignore';

/**
 * Whether an Exclusion removes this path, so that it appears nowhere in the
 * Export.
 *
 * The in-flight Export's own file travels in as `exportFileName` rather than
 * living in module state, so an Export never contains a previous one and two
 * Exports cannot collide.
 */
export async function isExcluded(
    filePath: string,
    workspaceRoot: string,
    configuration: ResolvedConfiguration,
    exportFileName?: string
): Promise<boolean> {
    const relativePath = path.relative(workspaceRoot, filePath);

    const isGitignored = await createGitignoreFilter(workspaceRoot);
    if (isGitignored(filePath)) {
        return true;
    }

    if (configuration.additionalIgnore.includes(relativePath)) {
        return true;
    }

    if (filePath === path.join(workspaceRoot, configuration.outputFile)) {
        return true;
    }

    if (exportFileName && filePath === path.join(workspaceRoot, exportFileName)) {
        return true;
    }

    if (configuration.binaryFiles.includes(relativePath)) {
        return true;
    }

    if (isBinaryFile(filePath, configuration.binaryFileExtensions)) {
        return true;
    }

    return false;
}
