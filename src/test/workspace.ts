import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultBinaryFileExtensions, ResolvedConfiguration } from '../core/configuration';

/**
 * Files to lay down, keyed by path relative to the workspace root. A key
 * ending in a separator creates an empty directory.
 */
export type WorkspaceFiles = Record<string, string | Buffer>;

/**
 * Build a real workspace on disk, run against it, then tear it down. The code
 * under test is a filesystem walker, so mocking the filesystem would test
 * nothing.
 */
export async function withWorkspace<T>(
    files: WorkspaceFiles,
    run: (root: string) => Promise<T> | T
): Promise<T> {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-exporter-')));
    try {
        for (const [relativePath, content] of Object.entries(files)) {
            const absolutePath = path.join(root, relativePath);
            if (relativePath.endsWith('/')) {
                await fs.mkdir(absolutePath, { recursive: true });
                continue;
            }
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.writeFile(absolutePath, content);
        }
        return await run(root);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}

/**
 * The configuration an Export runs with, as the adapter would have resolved
 * it. Defaults match the contributed settings.
 */
export function resolvedConfiguration(
    overrides: Partial<ResolvedConfiguration> = {}
): ResolvedConfiguration {
    return {
        outputFile: 'FULL_CODE.md',
        additionalIgnore: [],
        binaryFileExtensions: [...defaultBinaryFileExtensions],
        binaryFiles: [],
        ...overrides
    };
}
