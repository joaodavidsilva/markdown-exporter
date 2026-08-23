// @ts-check
'use strict';

/**
 * Bundles src/index.ts into out/index.js for packaging.
 *
 * This deliberately writes to the same path tsc's `compile` script emits to.
 * That's safe because `npm test` always reruns `tsc -p ./` first, which
 * regenerates the unbundled out/ tree from scratch before the suite runs —
 * so a bundle left over from a prior package step is never in the way.
 * `vscode:prepublish` runs compile (typecheck) then this script (bundle) in
 * that order, so the bundle is what's on disk when `vsce package` collects
 * files.
 *
 * `vscode` is external: it only exists inside the editor at runtime and must
 * never be bundled.
 */

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    outfile: 'out/index.js',
    external: ['vscode'],
    sourcemap: true,
    minify: production,
    logLevel: 'info',
};

async function main() {
    if (watch) {
        // Only the watch mode needs the incremental context/dispose API.
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        return;
    }

    // A one-shot build: esbuild.build() resolves only once the bundle is
    // fully written, with no separate rebuild/dispose choreography.
    await esbuild.build(buildOptions);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
