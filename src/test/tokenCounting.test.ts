import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { approximateTokens, createTokenTally, groupDigits } from '../core/tokenCounting';

test('a tally with nothing added reports zero tokens', () => {
    assert.equal(createTokenTally().total(), 0);
});

test('a chunk containing a special-token string is counted as ordinary text', () => {
    // Left at the tokenizer's default, this string throws rather than counts:
    // a repository that talks about tokenizers can contain it in an ordinary
    // file, and that file is not a reason to fail the whole Export.
    const tally = createTokenTally();
    tally.add('before <|endoftext|> after\n');

    assert.equal(tally.total() > 0, true);
});

test('splitting the same text across many small chunks counts the same as one', () => {
    const text = 'The quick brown fox jumps over the lazy dog.\n'.repeat(200);

    const whole = createTokenTally();
    whole.add(text);

    const piecemeal = createTokenTally();
    for (let index = 0; index < text.length; index += 7) {
        piecemeal.add(text.slice(index, index + 7));
    }

    // A streamed Export never hands the tally a whole file at once; this is
    // the guarantee that makes that safe to do.
    assert.equal(piecemeal.total(), whole.total());
});

test('tokens measured before rendering and tokens added after agree with a single count', () => {
    const text = 'export const total = tokens.reduce((a, b) => a + b, 0);\n'.repeat(50);

    const direct = createTokenTally();
    direct.add(text);
    const expected = direct.total();

    // This is the shape createExport uses: a file is measured once, and its
    // count is folded in with addCounted rather than the content being
    // tallied a second time as it is written.
    const combined = createTokenTally();
    combined.addCounted(expected);

    assert.equal(combined.total(), expected);
});

test('a very long run of text with nowhere to break is still counted in bounded pieces', () => {
    // A single unbroken run this long, handed to the tokenizer whole, has
    // been measured at upward of fifteen seconds — BPE merging is
    // superlinear in the length of one word, and this is one 200,000-character
    // word. A tally that holds the whole thing until a natural break, the way
    // it would have to if it kept the full document or file in memory to
    // count it, would cost the same. Finishing well inside that budget is
    // evidence the run was cut into bounded pieces rather than counted whole.
    const text = 'x'.repeat(200_000);

    const startedAt = Date.now();
    const tally = createTokenTally();
    tally.add(text);
    const total = tally.total();
    const elapsedMs = Date.now() - startedAt;

    assert.equal(total, 25_000);
    assert.equal(elapsedMs < 5000, true);
});

test('a token count is always said with the tilde that marks it approximate', () => {
    assert.equal(approximateTokens(0), '~0 tokens');
    assert.equal(approximateTokens(1), '~1 token');
    assert.equal(approximateTokens(2), '~2 tokens');
});

test('a token count in the thousands is grouped by three digits, not run together', () => {
    assert.equal(groupDigits(1204), '1,204');
    assert.equal(groupDigits(1234567), '1,234,567');
    assert.equal(groupDigits(128), '128');
});
