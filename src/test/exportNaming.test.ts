import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExportFileName, timestampedExportName } from '../core/exportNaming';

const noon = new Date(2026, 7, 22, 10, 0, 0);

test('an Export is written to the configured base name with a timestamp inside it', () => {
    assert.equal(
        timestampedExportName('FULL_CODE.md', noon),
        'FULL_CODE_2026-08-22_10-00-00.md'
    );
});

test('an Export keeps the configured extension', () => {
    assert.equal(timestampedExportName('code.txt', noon), 'code_2026-08-22_10-00-00.txt');
});

test('an Export is named from the base name alone, whatever directory was configured', () => {
    assert.equal(
        timestampedExportName('docs/export.md', noon),
        'export_2026-08-22_10-00-00.md'
    );
});

test('a Destination configured with nothing usable still gets a name', () => {
    assert.equal(timestampedExportName('   ', noon), 'export_2026-08-22_10-00-00.md');
});

test('every name a file Destination writes is recognised as an Export', () => {
    for (const outputFile of ['FULL_CODE.md', 'code.txt', 'docs/export.md', 'dump', '  ']) {
        const written = timestampedExportName(outputFile, noon);
        assert.equal(isExportFileName(written, outputFile), true, `not recognised: ${written}`);
    }
});

test('a user file that merely starts with the configured name is not an Export', () => {
    assert.equal(isExportFileName('FULL_CODE_notes.md', 'FULL_CODE.md'), false);
    assert.equal(isExportFileName('FULL_CODE_2026-08-22.md', 'FULL_CODE.md'), false);
    assert.equal(isExportFileName('FULL_CODE_v2.md', 'FULL_CODE.md'), false);
    assert.equal(isExportFileName('OLD_FULL_CODE_2026-08-22_10-00-00.md', 'FULL_CODE.md'), false);
});

test('an Export of one configured name is not recognised under another', () => {
    assert.equal(isExportFileName('FULL_CODE_2026-08-22_10-00-00.md', 'CODE.md'), false);
    assert.equal(isExportFileName('FULL_CODE_2026-08-22_10-00-00.txt', 'FULL_CODE.md'), false);
});

test('the configured name itself is not a timestamped Export', () => {
    assert.equal(isExportFileName('FULL_CODE.md', 'FULL_CODE.md'), false);
});
