import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import GitRunner from '../src/core/git/GitRunner';
import { createTempDir } from './helpers';
import { createSubagentSourceRepository, subagentSourceFiles } from './fixtures/subagentSource';

describe('Etap 0 baseline fixture', () => {
    test('creates a local Git source with skill, subagent, sidecar and shared files', () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');

        try {
            createSubagentSourceRepository(sourceDir);

            Object.values(subagentSourceFiles).forEach((relativePath) => {
                expect(fs.existsSync(path.join(sourceDir, relativePath))).toBe(true);
            });
            expect(fs.readFileSync(path.join(sourceDir, subagentSourceFiles.sidecar), 'utf8')).toContain('schema_version: 1');
            expect(fs.readFileSync(path.join(sourceDir, subagentSourceFiles.sidecar), 'utf8')).toContain('shared_files:');
            expect(fs.readdirSync(path.join(sourceDir, '.git'))).toEqual(expect.arrayContaining(['HEAD', 'config', 'objects']));
            const commit = new GitRunner().run(sourceDir, ['rev-parse', 'HEAD']);
            expect(commit.ok).toBe(true);
            if (commit.ok) {
                expect(commit.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
            }
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
