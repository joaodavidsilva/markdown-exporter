/**
 * The one function this project uses out of `gpt-tokenizer`, declared here
 * rather than taken from the package.
 *
 * The package ships its own types, but its `.d.ts` files use arbitrary module
 * namespace identifiers (`import { "gpt-4o" as spec }`), which is a
 * TypeScript 5.0 feature and this project is on 4.9 for ESLint 8. Declaring
 * the single function the core calls costs less than a compiler upgrade that
 * belongs to nobody's ticket, and it states the whole of the surface the core
 * depends on in one place — so an upgrade that changed it would be read here
 * rather than discovered somewhere in the pipeline.
 *
 * The path has no `cjs`/`esm` in it because Node and esbuild both resolve it
 * through the package's `exports` map. TypeScript does not read that map under
 * this project's module resolution, which is exactly why the declaration is
 * needed at all.
 */
declare module 'gpt-tokenizer/encoding/o200k_base' {
    export interface EncodeOptions {
        /** Special tokens that may appear in the input as themselves. */
        allowedSpecial?: Set<string>;
        /**
         * Special tokens whose appearance in the input is an error. An empty
         * set is what makes a file containing `<|endoftext|>` ordinary text
         * rather than a thrown Export.
         */
        disallowedSpecial?: Set<string>;
    }

    export function countTokens(input: string, encodeOptions?: EncodeOptions): number;
}
