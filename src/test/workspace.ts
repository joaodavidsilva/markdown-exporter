import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultBinaryFileExtensions, defaultMaxFileSizeBytes, defaultRedactionEnabled, defaultTokenWarningThreshold, ResolvedConfiguration } from '../core/configuration';

/** A symlink to lay down, rather than a file with content. */
export interface WorkspaceSymlink {
    /** What the link points at, relative to the workspace root. */
    linkTo: string;
}

/**
 * Lay down a symlink at this key. The target need not exist — a link that
 * points nowhere is one of the cases the Expansion has to survive.
 */
export function symlinkTo(relativeTarget: string): WorkspaceSymlink {
    return { linkTo: relativeTarget };
}

/**
 * Files to lay down, keyed by path relative to the workspace root. A key
 * ending in a separator creates an empty directory; a `symlinkTo` value
 * creates a link instead of a file.
 */
export type WorkspaceFiles = Record<string, string | Buffer | WorkspaceSymlink>;

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
        // Files first, then links: a link whose target is laid down later
        // would otherwise be born broken by accident rather than on purpose.
        const links: [string, WorkspaceSymlink][] = [];

        for (const [relativePath, content] of Object.entries(files)) {
            const absolutePath = path.join(root, relativePath);
            if (relativePath.endsWith('/')) {
                await fs.mkdir(absolutePath, { recursive: true });
                continue;
            }
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            if (isSymlink(content)) {
                links.push([absolutePath, content]);
                continue;
            }
            await fs.writeFile(absolutePath, content);
        }

        for (const [absolutePath, link] of links) {
            await fs.symlink(path.join(root, link.linkTo), absolutePath);
        }
        return await run(root);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}

function isSymlink(content: string | Buffer | WorkspaceSymlink): content is WorkspaceSymlink {
    return typeof content === 'object' && !Buffer.isBuffer(content);
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
        maxFileSizeBytes: defaultMaxFileSizeBytes,
        tokenWarningThreshold: defaultTokenWarningThreshold,
        redactionEnabled: defaultRedactionEnabled,
        ...overrides
    };
}

/**
 * The files on disk that supply Exclusion rules — every `.gitignore` in the
 * tree, nested ones included, and the `.exportignore` at the workspace root.
 * Counting by name rather than by path is what keeps the helper honest as
 * sources are added.
 */
const exclusionSourceNames = new Set(['.gitignore', '.exportignore']);

/**
 * Count real reads of the Exclusion sources while `run` executes.
 *
 * The filesystem is not mocked: every read still goes to the real temporary
 * directory and returns the real bytes. `readFile` is only wrapped on the way
 * through, so what is counted is how many times the file was actually read —
 * not which function happened to be called.
 */
export async function countingExclusionSourceReads<T>(
    run: () => Promise<T>
): Promise<{ result: T; reads: number }> {
    const module = fs as unknown as {
        readFile: (...args: unknown[]) => Promise<unknown>;
    };
    const originalReadFile = module.readFile;
    let reads = 0;

    module.readFile = (...args: unknown[]) => {
        const [target] = args;
        if (typeof target === 'string' && exclusionSourceNames.has(path.basename(target))) {
            reads += 1;
        }
        return originalReadFile(...args);
    };

    try {
        return { result: await run(), reads };
    } finally {
        module.readFile = originalReadFile;
    }
}
