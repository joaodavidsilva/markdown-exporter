import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import { binarySniffBytes, hasBinaryContent, hasBinaryExtension } from '../core/binaryDetection';
import { withWorkspace } from './workspace';

const extensions = ['png', 'zip', 'pdf'];

test('a file whose extension is on the configured list is binary', () => {
    assert.equal(hasBinaryExtension('/workspace/assets/logo.png', extensions), true);
});

test('a file whose extension is not on the configured list is not binary', () => {
    assert.equal(hasBinaryExtension('/workspace/src/index.ts', extensions), false);
});

test('the extension is matched regardless of case', () => {
    assert.equal(hasBinaryExtension('/workspace/assets/PHOTO.PNG', extensions), true);
});

test('a file without an extension is not binary', () => {
    assert.equal(hasBinaryExtension('/workspace/Makefile', extensions), false);
});

test('a dotfile is not binary because of its leading dot', () => {
    assert.equal(hasBinaryExtension('/workspace/.gitignore', extensions), false);
});

test('an empty list of extensions classifies nothing as binary', () => {
    assert.equal(hasBinaryExtension('/workspace/assets/logo.png', []), false);
});

test('a file whose opening bytes contain a null byte is binary by content', async () => {
    const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    await withWorkspace({ 'module.wasm': wasm }, async root => {
        assert.equal(await hasBinaryContent(path.join(root, 'module.wasm')), true);
    });
});

test('a text file is not binary by content', async () => {
    await withWorkspace({ 'src/index.ts': 'export const answer = 42;\n' }, async root => {
        assert.equal(await hasBinaryContent(path.join(root, 'src/index.ts')), false);
    });
});

test('an empty file is not binary by content', async () => {
    await withWorkspace({ 'empty.txt': '' }, async root => {
        assert.equal(await hasBinaryContent(path.join(root, 'empty.txt')), false);
    });
});

test('a null byte past the sniffed opening is not looked for', async () => {
    const content = Buffer.concat([
        Buffer.from('x'.repeat(binarySniffBytes + 16)),
        Buffer.from([0x00])
    ]);

    await withWorkspace({ 'late.bin': content }, async root => {
        assert.equal(await hasBinaryContent(path.join(root, 'late.bin')), false);
    });
});
