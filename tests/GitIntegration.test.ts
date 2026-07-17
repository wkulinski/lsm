import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import GitRunner from '../src/core/git/GitRunner';
import GitSourceClient from '../src/core/source/GitSourceClient';
import { createTempDir } from './helpers';

describe('local Git integration', () => {
    test('commits, detects the default branch and clones without network access', () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const runner = new GitRunner();
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '# Local skill\n', 'utf8');

        try {
            expect(runner.run(null, ['init', sourceDir]).ok).toBe(true);
            expect(runner.run(sourceDir, ['config', 'user.email', 'test@example.com']).ok).toBe(true);
            expect(runner.run(sourceDir, ['config', 'user.name', 'Test User']).ok).toBe(true);
            expect(runner.run(sourceDir, ['add', 'SKILL.md']).ok).toBe(true);
            expect(runner.run(sourceDir, ['commit', '-m', 'initial']).ok).toBe(true);

            const client = new GitSourceClient();
            const branch = client.detectDefaultBranch(sourceDir);
            expect(branch).toMatch(/^(main|master)$/);

            const clone = client.cloneRepo({ url: sourceDir, ref: branch });
            expect(clone.ok).toBe(true);
            if (!clone.ok) {
                return;
            }

            try {
                expect(fs.readFileSync(path.join(clone.dir, 'SKILL.md'), 'utf8')).toBe('# Local skill\n');
            }
            finally {
                client.cleanupTempDir(clone.dir);
            }
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
