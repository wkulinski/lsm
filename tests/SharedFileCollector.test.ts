import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import SharedFileCollector from '../src/core/source/SharedFileCollector';
import { createTempDir } from './helpers';

describe('SharedFileCollector', () => {
    test('collects files recursively and validates relative paths', () => {
        const tempDir = createTempDir();

        try {
            const sourceDir = path.join(tempDir, 'source');
            const linkedDir = path.join(tempDir, 'linked');
            fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
            fs.mkdirSync(linkedDir, { recursive: true });
            fs.writeFileSync(path.join(sourceDir, 'root.txt'), 'root\n', 'utf8');
            fs.writeFileSync(path.join(sourceDir, 'nested', 'inner.txt'), 'inner\n', 'utf8');
            fs.writeFileSync(path.join(linkedDir, 'outside.txt'), 'outside\n', 'utf8');
            fs.symlinkSync(path.join(linkedDir, 'outside.txt'), path.join(sourceDir, 'linked-outside.txt'));

            const collector = new SharedFileCollector();

            expect(collector.collectFilesRecursively(sourceDir).map(file => file.relativePath)).toEqual([
                'nested/inner.txt',
                'root.txt',
            ]);
            expect(collector.collectSharedFiles(sourceDir, ['linked-outside.txt'])).toEqual({
                ok: false,
                error: 'Shared file path contains a symbolic link: linked-outside.txt',
            });
            expect(collector.normalizeRelativePath(' nested\\inner.txt ', 'field')).toBe('nested/inner.txt');
            expect(() => collector.normalizeRelativePath('../outside.txt', 'field')).toThrow('"field" cannot contain ".."');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
