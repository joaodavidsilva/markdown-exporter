import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBinaryFile } from '../core/binaryDetection';

const extensions = ['png', 'zip', 'pdf'];

test('a file whose extension is on the configured list is binary', () => {
    assert.equal(isBinaryFile('/workspace/assets/logo.png', extensions), true);
});

test('a file whose extension is not on the configured list is not binary', () => {
    assert.equal(isBinaryFile('/workspace/src/index.ts', extensions), false);
});

test('the extension is matched regardless of case', () => {
    assert.equal(isBinaryFile('/workspace/assets/PHOTO.PNG', extensions), true);
});

test('a file without an extension is not binary', () => {
    assert.equal(isBinaryFile('/workspace/Makefile', extensions), false);
});

test('a dotfile is not binary because of its leading dot', () => {
    assert.equal(isBinaryFile('/workspace/.gitignore', extensions), false);
});

test('an empty list of extensions classifies nothing as binary', () => {
    assert.equal(isBinaryFile('/workspace/assets/logo.png', []), false);
});
