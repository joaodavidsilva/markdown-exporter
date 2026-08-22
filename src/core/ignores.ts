import * as path from 'path';
import { isBinaryFile } from './binaryDetection';
import { ResolvedConfiguration } from './configuration';
import { createGitignoreFilter } from './gitignore';

/**
 * Whether an Exclusion rule removes this path from the Expansion.
 *
 * The in-flight Export's own file travels in as `exportFileName` rather than
 * living in module state, so two Exports can run without colliding.
 */
export function shouldIgnoreFile(
    filePath: string,
    workspaceRoot: string,
    configuration: ResolvedConfiguration,
    exportFileName?: string
): boolean {
    const relativePath = path.relative(workspaceRoot, filePath);

    const gitignoreFilter = createGitignoreFilter(workspaceRoot);

    if (gitignoreFilter(filePath)) {
        return true;
    }

    if (configuration.additionalIgnore.includes(relativePath)) {
        return true;
    }

    // Exclude the configured Destination (legacy, un-stamped) and the file this
    // Export is writing to, so an Export never contains a previous one.
    const configuredOutputPath = path.join(workspaceRoot, configuration.outputFile);
    if (filePath === configuredOutputPath) {
        return true;
    }
    if (exportFileName) {
        const exportPath = path.join(workspaceRoot, exportFileName);
        if (filePath === exportPath) {
            return true;
        }
    }

    if (configuration.binaryFiles.includes(relativePath)) {
        return true;
    }

    if (isBinaryFile(filePath, configuration.binaryFileExtensions)) {
        return true;
    }

    return false;
}
