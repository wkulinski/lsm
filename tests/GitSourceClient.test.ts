import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import GitSourceClient from '../src/core/source/GitSourceClient';
import { createTempDir } from './helpers';

describe('GitSourceClient', () => {
    test('captures git command output without network access', () => {
        const client = new GitSourceClient();

        const result = client.gitCapture(process.cwd(), ['--version']);

        expect(result.ok).toBe(true);
        expect(result.stdout).toContain('git version');
        expect(result.stderr).toBe('');
    });

    test('cleans temporary directories defensively', () => {
        const tempDir = createTempDir();
        const nestedFile = path.join(tempDir, 'nested', 'file.txt');
        fs.mkdirSync(path.dirname(nestedFile), { recursive: true });
        fs.writeFileSync(nestedFile, 'temporary\n', 'utf8');

        const client = new GitSourceClient();

        client.cleanupTempDir(tempDir);
        client.cleanupTempDir(null);

        expect(fs.existsSync(tempDir)).toBe(false);
    });
});
