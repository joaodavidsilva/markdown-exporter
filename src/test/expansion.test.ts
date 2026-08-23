import * as assert from 'node:assert/strict';
import { chmod, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';
import { ExportCancelled } from '../core/cancellation';
import { createBufferedDestination } from '../core/destinations';
import { createExport } from '../core/export';
import { expandSelection, ExpansionEntry } from '../core/expansion';
import { countingExclusionSourceReads, resolvedConfiguration, symlinkTo, withWorkspace } from './workspace';

function relativePaths(entries: { relativePath: string }[]): string[] {
    return entries.map(entry => entry.relativePath);
}

function entryAt(entries: ExpansionEntry[], relativePath: string): ExpansionEntry {
    const entry = entries.find(candidate => candidate.relativePath === relativePath);
    assert.ok(entry, `no entry at ${relativePath}, only ${relativePaths(entries).join(', ')}`);
    return entry;
}

/** The Stub reason at a path, or undefined where the entry is embedded. */
function stubReasonAt(entries: ExpansionEntry[], relativePath: string): string | undefined {
    const entry = entryAt(entries, relativePath);
    return entry.classification === 'stub' ? entry.reason : undefined;
}

/** Running as root defeats every permission fixture: chmod stops meaning no. */
const cannotDenyItself = process.getuid?.() === 0;

test('a picked file becomes one entry, at its path relative to the workspace root', async () => {
    await withWorkspace({ 'src/index.ts': 'export {};\n' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [path.join(root, 'src/index.ts')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('a picked file is classified as embedded', async () => {
    await withWorkspace({ 'src/index.ts': 'export {};\n' }, async root => {
        const [entry] = await expandSelection({
            selectionPaths: [path.join(root, 'src/index.ts')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.equal(entry.classification, 'embed');
    });
});

test('a picked folder expands to every file beneath it', async () => {
    await withWorkspace({
        'src/index.ts': '',
        'src/deep/nested/util.ts': '',
        'README.md': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [path.join(root, 'src')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [
            path.join('src', 'deep', 'nested', 'util.ts'),
            path.join('src', 'index.ts')
        ]);
    });
});

test('entries come back in the same order whatever order the Selection was picked in', async () => {
    const files = { 'a.ts': '', 'b.ts': '', 'c.ts': '' };
    const picked = ['c.ts', 'a.ts', 'b.ts'];

    await withWorkspace(files, async root => {
        const entries = await expandSelection({
            selectionPaths: picked.map(name => path.join(root, name)),
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), ['a.ts', 'b.ts', 'c.ts']);
    });
});

test('an empty Selection expands to no entries', async () => {
    await withWorkspace({ 'a.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(entries, []);
    });
});

test('a Selection path that no longer exists is skipped rather than failing the Expansion', async () => {
    await withWorkspace({ 'a.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [path.join(root, 'gone.ts'), path.join(root, 'a.ts')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), ['a.ts']);
    });
});

test('a file a .gitignore rule matches is excluded from the Expansion', async () => {
    await withWorkspace({
        '.gitignore': '*.log\n',
        'debug.log': '',
        'src/index.ts': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.equal(relativePaths(entries).includes('debug.log'), false);
        assert.equal(relativePaths(entries).includes(path.join('src', 'index.ts')), true);
    });
});

test('everything beneath a directory a .gitignore rule matches is excluded', async () => {
    await withWorkspace({
        '.gitignore': 'node_modules/\n',
        'node_modules/left-pad/index.js': '',
        'src/index.ts': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), ['.gitignore', path.join('src', 'index.ts')]);
    });
});

test('a nested .gitignore is honoured, not only the one at the workspace root', async () => {
    await withWorkspace({
        '.gitignore': '*.log\n',
        'src/.gitignore': '*.snap\n',
        'src/component.snap': '',
        'src/index.ts': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.equal(relativePaths(entries).includes(path.join('src', 'component.snap')), false);
        assert.equal(relativePaths(entries).includes(path.join('src', 'index.ts')), true);
    });
});

test('a negation in a nested .gitignore re-includes what the root one excluded', async () => {
    await withWorkspace({
        '.gitignore': '*.log\n',
        'src/.gitignore': '!keep.log\n',
        'src/keep.log': '',
        'src/drop.log': '',
        'drop.log': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        const paths = relativePaths(entries);
        assert.equal(paths.includes(path.join('src', 'keep.log')), true);
        assert.equal(paths.includes(path.join('src', 'drop.log')), false);
        assert.equal(paths.includes('drop.log'), false);
    });
});

test('a nested .gitignore inside a directory the root excluded is never reached', async () => {
    await withWorkspace({
        '.gitignore': 'node_modules/\n',
        'node_modules/.gitignore': '!keep.js\n',
        'node_modules/left-pad/keep.js': '',
        'src/index.ts': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        // git cannot re-include a file beneath an excluded directory, and the
        // walk never descends into one, so the negation below never applies.
        assert.deepEqual(relativePaths(entries), ['.gitignore', path.join('src', 'index.ts')]);
    });
});

test('a file listed in additionalIgnore is excluded from the Expansion', async () => {
    await withWorkspace({ 'notes.md': '', 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration({ additionalIgnore: ['notes.md'] })
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('a previous Export at the configured output file is never part of a new one', async () => {
    await withWorkspace({ 'FULL_CODE.md': '# Project Code Export\n', 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('the file this Export writes to is never part of it', async () => {
    await withWorkspace({ 'FULL_CODE_2026-01-01_00-00-00.md': '', 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration(),
            exportFileName: 'FULL_CODE_2026-01-01_00-00-00.md'
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('.git is never part of an Expansion, with no .gitignore present', async () => {
    await withWorkspace({
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.git/objects/ab/cdef': 'object\n',
        'src/index.ts': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('.git is never part of an Expansion when a .gitignore that does not mention it is present', async () => {
    await withWorkspace({
        '.gitignore': '*.log\n',
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.git/objects/ab/cdef': 'object\n',
        'src/index.ts': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), ['.gitignore', path.join('src', 'index.ts')]);
    });
});

test('a .git nested beneath the workspace root is suppressed too', async () => {
    await withWorkspace({
        'vendor/library/.git/HEAD': 'ref: refs/heads/main\n',
        'vendor/library/index.ts': ''
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [path.join('vendor', 'library', 'index.ts')]);
    });
});

test('a picked .git is suppressed, since the suppression is not configurable', async () => {
    await withWorkspace({ '.git/HEAD': 'ref: refs/heads/main\n' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [path.join(root, '.git')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(entries, []);
    });
});

test('.git is not walked at all, not merely filtered out of the entries', async () => {
    if (process.getuid?.() === 0) {
        return;
    }

    await withWorkspace({
        '.git/objects/ab/cdef': 'object\n',
        'src/index.ts': ''
    }, async root => {
        const gitDirectory = path.join(root, '.git');
        // A directory that cannot be read at all: reaching into it would fail
        // the Expansion, so completing proves the walk never went in.
        await chmod(gitDirectory, 0o000);
        try {
            const entries = await expandSelection({
                selectionPaths: [root],
                workspaceRoot: root,
                configuration: resolvedConfiguration()
            });

            assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
        } finally {
            await chmod(gitDirectory, 0o755);
        }
    });
});

test('the Exclusion sources are read once per Export, not once per file', async () => {
    const files: Record<string, string> = { '.gitignore': '*.log\n' };
    for (let index = 0; index < 250; index += 1) {
        files[`src/module-${index % 25}/file-${index}.ts`] = `export const v = ${index};\n`;
    }

    await withWorkspace(files, async root => {
        const { result, reads } = await countingExclusionSourceReads(async () => {
            const entries = await expandSelection({
                selectionPaths: [root],
                workspaceRoot: root,
                configuration: resolvedConfiguration(),
                exportFileName: 'EXPORT.md'
            });
            await createExport({
                entries,
                configuration: resolvedConfiguration(),
                destination: createBufferedDestination()
            });
            return entries;
        });

        // The tree is large enough that a read per file visited would be
        // unmistakable: 251 files across 25 directories.
        assert.equal(result.length, 251);
        assert.equal(reads, 1);
    });
});

test('an Expansion asked to run under an already aborted signal does not run', async () => {
    await withWorkspace({ 'src/index.ts': '' }, async root => {
        const controller = new AbortController();
        controller.abort();

        await assert.rejects(
            expandSelection({
                selectionPaths: [root],
                workspaceRoot: root,
                configuration: resolvedConfiguration(),
                signal: controller.signal
            }),
            ExportCancelled
        );
    });
});

test('an Expansion aborted part way through stops walking', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 400; index += 1) {
        files[`src/module-${index % 20}/file-${index}.ts`] = '';
    }

    await withWorkspace(files, async root => {
        const controller = new AbortController();
        let found = 0;

        await assert.rejects(
            expandSelection({
                selectionPaths: [root],
                workspaceRoot: root,
                configuration: resolvedConfiguration(),
                signal: controller.signal,
                onProgress: () => {
                    found += 1;
                    if (found === 10) {
                        controller.abort();
                    }
                }
            }),
            ExportCancelled
        );

        // It stopped near where it was told to, rather than finishing the walk.
        assert.equal(found < 400, true);
    });
});

test('an Expansion reports a growing count of the files it has found', async () => {
    await withWorkspace({
        'src/a.ts': '',
        'src/deep/b.ts': '',
        'src/deep/c.ts': ''
    }, async root => {
        const counts: number[] = [];

        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration(),
            onProgress: update => {
                assert.equal(update.phase, 'expansion');
                counts.push(update.completed);
            }
        });

        assert.deepEqual(counts, [1, 2, 3]);
        assert.equal(counts[counts.length - 1], entries.length);
    });
});

test('an Expansion that is never cancelled needs no signal at all', async () => {
    await withWorkspace({ 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('a binary file is a Stub in the Expansion, not an Exclusion from it', async () => {
    await withWorkspace({ 'assets/logo.png': 'not really a png', 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        // It is mentioned, which is the whole difference from an Exclusion.
        assert.equal(stubReasonAt(entries, path.join('assets', 'logo.png')), 'binary');
        assert.equal(stubReasonAt(entries, path.join('src', 'index.ts')), undefined);
    });
});

test('a binary file picked outright is a Stub too', async () => {
    await withWorkspace({ 'assets/logo.png': 'not really a png' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [path.join(root, 'assets/logo.png')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.equal(stubReasonAt(entries, path.join('assets', 'logo.png')), 'binary');
    });
});

test('a file listed in binaryFiles is a Stub', async () => {
    await withWorkspace({ 'data.custom': 'text', 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration({ binaryFiles: ['data.custom'] })
        });

        assert.equal(stubReasonAt(entries, 'data.custom'), 'binary');
    });
});

test('a file the extension list has never heard of is a Stub when its content is binary', async () => {
    const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    await withWorkspace({ 'build/module.wasm': wasm, 'src/index.ts': 'export {};\n' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.equal(resolvedConfiguration().binaryFileExtensions.includes('wasm'), false);
        assert.equal(stubReasonAt(entries, path.join('build', 'module.wasm')), 'binary');
        assert.equal(stubReasonAt(entries, path.join('src', 'index.ts')), undefined);
    });
});

test('a file over the size threshold is a Stub saying so', async () => {
    await withWorkspace({ 'debug.log': 'x'.repeat(2048), 'src/index.ts': '' }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration({ maxFileSizeBytes: 1024 })
        });

        assert.equal(stubReasonAt(entries, 'debug.log'), 'too-large');
        assert.equal(stubReasonAt(entries, path.join('src', 'index.ts')), undefined);
    });
});

test('a file exactly at the size threshold is still embedded', async () => {
    await withWorkspace({ 'edge.txt': 'x'.repeat(1024) }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration({ maxFileSizeBytes: 1024 })
        });

        assert.equal(stubReasonAt(entries, 'edge.txt'), undefined);
    });
});

test('a size threshold of zero means no threshold at all', async () => {
    await withWorkspace({ 'debug.log': 'x'.repeat(4096) }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration({ maxFileSizeBytes: 0 })
        });

        assert.equal(stubReasonAt(entries, 'debug.log'), undefined);
    });
});

test('a file that cannot be read is a Stub and the rest of the Expansion survives', async () => {
    if (cannotDenyItself) {
        return;
    }

    await withWorkspace({ 'secret.txt': 'classified', 'src/index.ts': '' }, async root => {
        const secret = path.join(root, 'secret.txt');
        await chmod(secret, 0o000);
        try {
            const entries = await expandSelection({
                selectionPaths: [root],
                workspaceRoot: root,
                configuration: resolvedConfiguration()
            });

            assert.equal(stubReasonAt(entries, 'secret.txt'), 'unreadable');
            assert.equal(stubReasonAt(entries, path.join('src', 'index.ts')), undefined);
        } finally {
            await chmod(secret, 0o644);
        }
    });
});

test('a directory that cannot be read is a Stub and does not cost the Export', async () => {
    if (cannotDenyItself) {
        return;
    }

    await withWorkspace({ 'vault/key.txt': 'classified', 'src/index.ts': '' }, async root => {
        const vault = path.join(root, 'vault');
        await chmod(vault, 0o000);
        try {
            const entries = await expandSelection({
                selectionPaths: [root],
                workspaceRoot: root,
                configuration: resolvedConfiguration()
            });

            assert.equal(stubReasonAt(entries, 'vault'), 'unreadable');
            assert.equal(stubReasonAt(entries, path.join('src', 'index.ts')), undefined);
            // Its contents are not claimed to be there, only the folder itself.
            assert.equal(relativePaths(entries).includes(path.join('vault', 'key.txt')), false);
        } finally {
            await chmod(vault, 0o755);
        }
    });
});

test('a directory symlink pointing back up its own tree terminates the walk', async () => {
    await withWorkspace({
        'src/index.ts': 'export {};\n',
        'src/loop': symlinkTo('src'),
        'src/up': symlinkTo('')
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), [path.join('src', 'index.ts')]);
    });
});

test('a symlink to a file is followed, since no cycle can go through one', async () => {
    await withWorkspace({
        'real.ts': 'export const answer = 42;\n',
        'alias.ts': symlinkTo('real.ts')
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.deepEqual(relativePaths(entries), ['alias.ts', 'real.ts']);
        assert.equal(stubReasonAt(entries, 'alias.ts'), undefined);
    });
});

test('a symlink pointing nowhere is a Stub rather than the end of the Expansion', async () => {
    await withWorkspace({
        'src/index.ts': '',
        'src/dangling.ts': symlinkTo('src/gone.ts')
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        assert.equal(stubReasonAt(entries, path.join('src', 'dangling.ts')), 'unreadable');
        assert.equal(stubReasonAt(entries, path.join('src', 'index.ts')), undefined);
    });
});

test('a picked directory symlink is resolved once, and the walk beneath it still terminates', async () => {
    await withWorkspace({
        'src/index.ts': 'export {};\n',
        'src/loop': symlinkTo('src'),
        'entrance': symlinkTo('src')
    }, async root => {
        const entries = await expandSelection({
            selectionPaths: [path.join(root, 'entrance')],
            workspaceRoot: root,
            configuration: resolvedConfiguration()
        });

        // Reported at the path the walk reached it by, which is the one the
        // user picked. The link inside is not followed a second time, so this
        // finishing at all is the point of the test.
        assert.deepEqual(relativePaths(entries), [path.join('entrance', 'index.ts')]);
    });
});

test('a file growing past the threshold between Exports changes side', async () => {
    await withWorkspace({ 'notes.md': 'small\n' }, async root => {
        const configuration = resolvedConfiguration({ maxFileSizeBytes: 32 });
        const before = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration
        });
        assert.equal(stubReasonAt(before, 'notes.md'), undefined);

        await writeFile(path.join(root, 'notes.md'), 'x'.repeat(64));

        const after = await expandSelection({
            selectionPaths: [root],
            workspaceRoot: root,
            configuration
        });
        assert.equal(stubReasonAt(after, 'notes.md'), 'too-large');
    });
});
