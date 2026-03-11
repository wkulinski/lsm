import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { createManager } from '../src/index';

describe('SkillsManager publish', () => {
    test('returns source selection error before any backend dependency check', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsm-test-'));

        try {
            writeJson(path.join(tempDir, 'skills.json'), {
                agents: ['codex'],
                sources: [
                    { source: 'owner/repo-a' },
                    { source: 'owner/repo-b' },
                ],
            });
            writeJson(path.join(tempDir, 'skills.lock.json'), {
                schemaVersion: 5,
                generatedAt: new Date().toISOString(),
                agents: ['codex'],
                sources: {},
            });

            const manager = createManager({ cwd: tempDir });
            const result = await manager.runPublish({ dryRun: true });

            expect(result.status).toBe('error');
            if (result.status !== 'error') {
                return;
            }

            expect(result.error).toBe('Multiple sources configured. Use --source <source>.');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('uses lock validation instead of external skills package dependency', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsm-test-'));

        try {
            writeJson(path.join(tempDir, 'skills.json'), {
                agents: ['codex'],
                sources: [
                    { source: 'owner/repo-a' },
                ],
            });
            writeJson(path.join(tempDir, 'skills.lock.json'), {
                schemaVersion: 5,
                generatedAt: new Date().toISOString(),
                agents: ['codex'],
                sources: {
                    'owner/repo-a': {
                        mode: 'all',
                        listedAt: null,
                        skillEntries: [],
                        sharedFileHashes: [],
                        resolved: {
                            requestedRef: null,
                            defaultBranch: null,
                            resolvedRef: null,
                            resolvedCommit: null,
                            subpath: null,
                            resolvedAt: null,
                        },
                    },
                },
            });

            const manager = createManager({ cwd: tempDir });
            const result = await manager.runPublish({ dryRun: true });

            expect(result.status).toBe('error');
            if (result.status !== 'error') {
                return;
            }

            expect(result.error).toBe('Missing resolved commit for "owner/repo-a" in lock. Run sync first.');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

function writeJson(filePath: string, value: unknown): void {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
