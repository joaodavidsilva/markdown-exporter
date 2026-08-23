import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { languageHintFor } from '../core/languages';

// Direct tests for languageHintFor: the fence's language hint, judged one
// path at a time with nothing walked and nothing rendered around it. The
// interface was already the deep, pure kind — a file path in, a hint
// string out — so this ticket opens no new seam and changes no production
// code; it only starts using the door that was already there. Parallel in
// shape to `binaryDetection.test.ts`: plain strings in, a return value out,
// no workspace and no rendered Export.
//
// The deletion test is what justifies writing these at all: delete
// languageHintFor and every fact below would have to be re-proven by
// writing files to disk and rendering a whole Export to reach it, at a
// much higher cost and a much lower locality — the files on disk, not the
// assertion, would carry the meaning. Calling the function directly is the
// leverage this ticket exists to spend.

test('a mapped extension produces its hint', () => {
    assert.equal(languageHintFor('/workspace/src/index.ts'), 'typescript');
});

test("a name recognised by the file's own name wins over what its extension alone would suggest", () => {
    // CMakeLists.txt's extension is .txt, which maps to nothing on its own —
    // the name is what earns it 'cmake', proving the name-based check runs,
    // and wins, before the extension is ever consulted.
    assert.equal(languageHintFor('/workspace/CMakeLists.txt'), 'cmake');
});

test('the two named families are recognised past their first member', () => {
    // Neither family is a fixed list of names: an environment file is one
    // per deployment, a Dockerfile one per image. Both are matched by a
    // prefix or suffix rather than an exact lookup.
    assert.equal(languageHintFor('/workspace/.env.production'), 'dotenv');
    assert.equal(languageHintFor('/workspace/Dockerfile.builder'), 'dockerfile');
    assert.equal(languageHintFor('/workspace/api.dockerfile'), 'dockerfile');
});

test('an unmapped extension produces no hint at all, never a wrong one', () => {
    // A plain, nobody's-heard-of-it extension: absence is the whole fact.
    assert.equal(languageHintFor('/workspace/notes.zzz'), '');

    // No extension and no recognised name either — the same absence,
    // reached by the other route through the function.
    assert.equal(languageHintFor('/workspace/NOTICE'), '');

    // .m is the sharpest case: deliberately excluded even though it is well
    // known, because it names three languages at once — Objective-C, MATLAB
    // and Mathematica — and guessing any one of them would be wrong for the
    // other two most of the time. Absence beats a guess.
    assert.equal(languageHintFor('/workspace/solver.m'), '');
});
