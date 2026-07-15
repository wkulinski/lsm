import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { createManager } from '../src';
import { createTempDir, readJson, writeJson } from './helpers';

describe('SkillsManager sync', () => {
    test('creates manifest and lock templates when config files are missing', async () => {
        const tempDir = createTempDir();

        try {
            const manager = createManager({ cwd: tempDir });
            const result = await manager.runSync();

            expect(result.status).toBe('templates-created');
            if (result.status !== 'templates-created') {
                return;
            }

            expect(result.createdTemplates.toSorted()).toEqual(['skills.json', 'skills.lock.json']);
            expect(readJson(path.join(tempDir, 'skills.json'))).toEqual({
                agents: [],
                sources: [],
            });
            expect(readJson(path.join(tempDir, 'skills.lock.json'))).toMatchObject({
                schemaVersion: 5,
                agents: [],
                sources: {},
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe('SkillsManager publish', () => {
    test('returns source selection error before any backend dependency check', async () => {
        const tempDir = createTempDir();

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
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('uses lock validation for a source with no resolved commit', async () => {
        const tempDir = createTempDir();

        try {
            writeJson(path.join(tempDir, 'skills.json'), {
                agents: ['codex'],
                sources: [{ source: 'owner/repo-a' }],
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

            const result = await createManager({ cwd: tempDir }).runPublish({ dryRun: true });

            expect(result).toMatchObject({
                status: 'error',
                error: 'Missing resolved commit for "owner/repo-a" in lock. Run sync first.',
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('returns a rejected promise when the publish reporter throws', async () => {
        const tempDir = createTempDir();

        try {
            writeJson(path.join(tempDir, 'skills.json'), {
                agents: ['codex'],
                sources: [{ source: 'owner/repo' }],
            });
            writeJson(path.join(tempDir, 'skills.lock.json'), {
                schemaVersion: 5,
                generatedAt: new Date().toISOString(),
                agents: ['codex'],
                sources: {},
            });

            const manager = createManager({ cwd: tempDir });
            const promise = manager.runPublish({
                report: () => {
                    throw new Error('report failed');
                },
            });

            await expect(promise).rejects.toThrow('report failed');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
