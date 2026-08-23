import * as vscode from 'vscode';
import { defaultBinaryFileExtensions, defaultMaxFileSizeBytes, defaultRedactionEnabled, defaultTokenWarningThreshold, ResolvedConfiguration } from '../core/configuration';

/**
 * The adapter boundary for configuration: read the editor's settings once per
 * Export and hand the core a plain value (ADR-0001).
 */
export function getConfiguration(): ResolvedConfiguration {
    const config = vscode.workspace.getConfiguration('markdownExport');

    return {
        outputFile: config.get<string>('outputFile', 'FULL_CODE.md'),
        additionalIgnore: config.get<string[]>('additionalIgnore', []),
        binaryFileExtensions: config.get<string[]>('binaryFileExtensions', [...defaultBinaryFileExtensions]),
        binaryFiles: config.get<string[]>('binaryFiles', []),
        maxFileSizeBytes: config.get<number>('maxFileSizeBytes', defaultMaxFileSizeBytes),
        tokenWarningThreshold: config.get<number>('tokenWarningThreshold', defaultTokenWarningThreshold),
        redactionEnabled: config.get<boolean>('redactionEnabled', defaultRedactionEnabled)
    };
}
