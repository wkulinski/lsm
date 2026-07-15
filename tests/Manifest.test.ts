import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import Manifest from '../src/core/manifest/ManifestStore';
import { createTempDir, writeJson } from './helpers';

describe('Manifest', () => {
    test('normalizes manifest source entries and lock metadata', () => {
        const tempDir = createTempDir();

        try {
            const manifestPath = path.join(tempDir, 'skills.json');
            const lockPath = path.join(tempDir, 'skills.lock.json');
            writeJson(manifestPath, {
                agents: [' cursor ', 'codex', 'codex'],
                sources: [{
                    source: ' owner/repo ',
                    skills: [' beta ', 'alpha', 'alpha'],
                    publish: {
                        branchPrefix: ' publish ',
                        createPr: false,
                    },
                }],
            });
            writeJson(lockPath, {
                schemaVersion: 5,
                generatedAt: '2026-06-02T00:00:00.000Z',
                agents: [' codex ', 'cursor', 'codex'],
                sources: {
                    upstream: {
                        mode: 'all',
                        listedAt: '2026-06-02T00:00:00.000Z',
                        skillEntries: [{
                            name: ' Alpha ',
                            sourcePath: 'skills\\alpha',
                            sharedFiles: [' shared/z.md ', 'shared/a.md', 'shared/a.md'],
                            hash: {
                                treeSha256: ' tree ',
                                files: [
                                    { path: ' b.txt ', sha256: 'sha-b' },
                                    { path: 'a.txt', sha256: 'sha-a' },
                                ],
                            },
                        }],
                        sharedFileHashes: [
                            { path: ' shared/z.md ', sha256: 'shared-z' },
                            { path: 'shared/a.md', sha256: 'shared-a' },
                        ],
                        resolved: {
                            requestedRef: ' main ',
                            defaultBranch: ' main ',
                            resolvedRef: ' refs/heads/main ',
                            resolvedCommit: ' abc123 ',
                            subpath: ' skills ',
                            resolvedAt: ' 2026-06-02T00:00:00.000Z ',
                        },
                    },
                },
            });

            const store = new Manifest({ manifestPath, lockPath });

            expect(store.loadManifest()).toEqual({
                agents: ['codex', 'cursor'],
                sources: [{
                    source: 'owner/repo',
                    skills: ['alpha', 'beta'],
                    publish: {
                        branchPrefix: 'publish',
                        createPr: false,
                    },
                }],
            });
            expect(store.loadLock()).toEqual({
                schemaVersion: 5,
                agents: ['codex', 'cursor'],
                sources: {
                    upstream: {
                        mode: 'all',
                        listedAt: '2026-06-02T00:00:00.000Z',
                        skillEntries: [{
                            name: 'Alpha',
                            sourcePath: 'skills/alpha',
                            sharedFiles: ['shared/a.md', 'shared/z.md'],
                            hash: {
                                treeSha256: 'tree',
                                files: [
                                    { path: 'a.txt', sha256: 'sha-a' },
                                    { path: 'b.txt', sha256: 'sha-b' },
                                ],
                            },
                        }],
                        sharedFileHashes: [
                            { path: 'shared/a.md', sha256: 'shared-a' },
                            { path: 'shared/z.md', sha256: 'shared-z' },
                        ],
                        resolved: {
                            requestedRef: 'main',
                            defaultBranch: 'main',
                            resolvedRef: 'refs/heads/main',
                            resolvedCommit: 'abc123',
                            subpath: 'skills',
                            resolvedAt: '2026-06-02T00:00:00.000Z',
                        },
                    },
                },
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects invalid manifest source declarations', () => {
        const tempDir = createTempDir();

        try {
            const manifestPath = path.join(tempDir, 'skills.json');
            const lockPath = path.join(tempDir, 'skills.lock.json');
            const store = new Manifest({ manifestPath, lockPath });

            writeJson(manifestPath, {
                agents: ['codex'],
                sources: 'owner/repo',
            });
            expect(() => store.loadManifest()).toThrow('"sources" must be an array');

            writeJson(manifestPath, {
                agents: ['codex'],
                sources: ['owner/repo'],
            });
            expect(() => store.loadManifest()).toThrow('each source entry must be an object');

            writeJson(manifestPath, {
                agents: ['codex'],
                sources: [{
                    source: 'owner/repo',
                    copies: [],
                }],
            });
            expect(() => store.loadManifest()).toThrow('"copies" is no longer supported');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
