import * as path from 'path';
import { getConfiguration } from '../config/settings';
import { isBinaryFile } from './binaryDetection';
import { createGitignoreFilter } from './gitignore';

// Track current run's output file (timestamped) so we can ignore EXACT file.
let currentOutputFile: string | undefined; // relative path

export function setCurrentOutputFile(relativeFileName: string) {
    currentOutputFile = relativeFileName;
}

export function shouldIgnoreFile(filePath: string, workspaceRoot: string): boolean {
    const relativePath = path.relative(workspaceRoot, filePath);
    const config = getConfiguration();

    const gitignoreFilter = createGitignoreFilter(workspaceRoot);

    if (gitignoreFilter(filePath)) {
        return true;
    }

    if (config.additionalIgnore.includes(relativePath)) {
        return true;
    }

    // Ignore base configured output file (legacy) and the current timestamped output file (if set)
    const configuredOutputPath = path.join(workspaceRoot, config.outputFile);
    if (filePath === configuredOutputPath) {
        return true;
    }
    if (currentOutputFile) {
        const dynamicOutputPath = path.join(workspaceRoot, currentOutputFile);
        if (filePath === dynamicOutputPath) {
            return true;
        }
    }

    if (config.binaryFiles.includes(relativePath)) {
        return true;
    }

    if (isBinaryFile(filePath, config.binaryFileExtensions)) {
        return true;
    }

    return false;
}