import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { countBacktickRuns, fenceOf } from '../core/export';

// Direct tests for the fence-width scan: the pair `measureFile` used to be
// the only door into. One function tracks the longest run of backticks seen
// so far as it scans a string; the other turns that number into the fence
// the content needs — one backtick longer than its longest run, minimum
// three, so a run already inside the content can never be mistaken for the
// fence that encloses it. Parallel in shape to `binaryDetection.test.ts`:
// plain strings and numbers in, a return value out, no workspace and no
// rendered Export.

/** The longest run `countBacktickRuns` finds in a string held whole. */
function longestRunIn(text: string): number {
    const run = { current: 0, longest: 0 };
    countBacktickRuns(text, run);
    return run.longest;
}

test('content with no backticks gets the minimum fence width', () => {
    const content = 'const answer = 42;\n';

    assert.equal(longestRunIn(content), 0);
    assert.equal(fenceOf(longestRunIn(content)), '`'.repeat(3));
});

test('a single run of three backticks widens the fence past it', () => {
    const content = `Before\n\n${'`'.repeat(3)}js\nconst answer = 42;\n${'`'.repeat(3)}\n\nAfter\n`;

    assert.equal(longestRunIn(content), 3);
    assert.equal(fenceOf(longestRunIn(content)), '`'.repeat(4));
});

test('the longest of several separate runs decides the fence width, not the last one seen', () => {
    // Three separate runs — two, five, then three backticks — so a scan
    // that settled for the last run instead of the longest would land on
    // four backticks here, one short of what the middle run actually needs.
    const content = `${'`'.repeat(2)}\ntext\n${'`'.repeat(5)}\ntext\n${'`'.repeat(3)}\n`;

    assert.equal(longestRunIn(content), 5);
    assert.equal(fenceOf(longestRunIn(content)), '`'.repeat(6));
});

test('empty content gets the minimum fence width', () => {
    assert.equal(longestRunIn(''), 0);
    assert.equal(fenceOf(longestRunIn('')), '`'.repeat(3));
});

test('fenceOf never returns fewer than three backticks', () => {
    assert.equal(fenceOf(0), '`'.repeat(3));
    assert.equal(fenceOf(1), '`'.repeat(3));
    assert.equal(fenceOf(2), '`'.repeat(3));
});

test('fenceOf returns one more backtick than the longest run it is given', () => {
    assert.equal(fenceOf(3), '`'.repeat(4));
    assert.equal(fenceOf(6), '`'.repeat(7));
});
