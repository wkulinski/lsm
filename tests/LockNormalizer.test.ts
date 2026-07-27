import { describe, expect, test } from 'vitest';

import LockNormalizer, { LEGACY_LOCK_SCHEMA_VERSION } from '../src/core/manifest/LockNormalizer';

describe('LockNormalizer', () => {
    test('normalizes lock agents, sources, hashes, shared files, and resolved metadata', () => {
        const normalizer = new LockNormalizer({ lockFileName: 'skills.lock.json' });

        expect(normalizer.normalize({
            schemaVersion: LEGACY_LOCK_SCHEMA_VERSION,
            agents: [' codex ', 'cursor', 'codex'],
            sources: {
                upstream: {
                    mode: 'explicit',
                    listedAt: '2026-06-05T00:00:00.000Z',
                    skillEntries: [
                        {
                            name: ' Beta ',
                            sourcePath: '.agents\\skills\\beta',
                            sharedFiles: ['.agents/skills/shared/z.md', '.agents\\skills\\shared\\a.md'],
                        },
                        {
                            name: ' Alpha ',
                            sourcePath: '.agents/skills/alpha',
                            hash: {
                                treeSha256: ' tree ',
                                files: [
                                    { path: ' b.txt ', sha256: 'sha-b' },
                                    { path: 'a.txt', sha256: 'sha-a' },
                                ],
                            },
                        },
                    ],
                    sharedFileHashes: [
                        { path: '.agents/skills/shared/z.md', sha256: 'sha-z' },
                        { path: '.agents/skills/shared/a.md', sha256: 'sha-a' },
                    ],
                    resolved: {
                        requestedRef: ' main ',
                        defaultBranch: ' main ',
                        resolvedRef: ' refs/heads/main ',
                        resolvedCommit: ' abc123 ',
                        subpath: ' skills ',
                        resolvedAt: ' 2026-06-05T00:00:00.000Z ',
                    },
                },
            },
        })).toEqual({
            schemaVersion: LEGACY_LOCK_SCHEMA_VERSION,
            agents: ['codex', 'cursor'],
            subagents: [],
            sources: {
                upstream: {
                    mode: 'explicit',
                    listedAt: '2026-06-05T00:00:00.000Z',
                    skillEntries: [
                        {
                            name: 'Alpha',
                            sourcePath: '.agents/skills/alpha',
                            sharedFiles: [],
                            hash: {
                                treeSha256: 'tree',
                                files: [
                                    { path: 'a.txt', sha256: 'sha-a' },
                                    { path: 'b.txt', sha256: 'sha-b' },
                                ],
                            },
                        },
                        {
                            name: 'Beta',
                            sourcePath: '.agents/skills/beta',
                            sharedFiles: [
                                '.agents/skills/shared/a.md',
                                '.agents/skills/shared/z.md',
                            ],
                            hash: null,
                        },
                    ],
                    sharedFileHashes: [
                        { path: '.agents/skills/shared/a.md', sha256: 'sha-a' },
                        { path: '.agents/skills/shared/z.md', sha256: 'sha-z' },
                    ],
                    subagentEntries: [],
                    sharedEntries: [
                        {
                            sourcePath: '.agents/skills/shared/a.md',
                            targetPath: '.agents/skills/shared/a.md',
                            hash: { sha256: 'sha-a', executable: false },
                            owners: ['skill:Beta'],
                        },
                        {
                            sourcePath: '.agents/skills/shared/z.md',
                            targetPath: '.agents/skills/shared/z.md',
                            hash: { sha256: 'sha-z', executable: false },
                            owners: ['skill:Beta'],
                        },
                    ],
                    resolved: {
                        requestedRef: 'main',
                        defaultBranch: 'main',
                        resolvedRef: 'refs/heads/main',
                        resolvedCommit: 'abc123',
                        subpath: 'skills',
                        resolvedAt: '2026-06-05T00:00:00.000Z',
                    },
                },
            },
        });
    });

    test('rejects unsupported schemas and unsafe relative paths', () => {
        const normalizer = new LockNormalizer({ lockFileName: 'custom.lock.json' });

        expect(() => normalizer.normalize({
            schemaVersion: 4,
            agents: [],
            sources: {},
        })).toThrow('"custom.lock.json": unsupported schemaVersion=4; expected 5 or 6');
        expect(() => normalizer.normalizeRelativePath('../secret', 'lock.skillEntries.sourcePath')).toThrow(
            '"custom.lock.json": "lock.skillEntries.sourcePath" cannot contain ".."',
        );
        expect(() => normalizer.normalizeRelativePath('/absolute', 'lock.skillEntries.sourcePath')).toThrow(
            '"custom.lock.json": "lock.skillEntries.sourcePath" must be a relative path',
        );
    });

    test('normalizes and sorts v6 managed entries', () => {
        const normalizer = new LockNormalizer({ lockFileName: 'skills.lock.json' });

        expect(normalizer.normalize({
            schemaVersion: 6,
            agents: ['codex'],
            subagents: ['opencode'],
            sources: {
                upstream: {
                    mode: 'explicit',
                    skillEntries: [],
                    subagentEntries: [{
                        name: 'reviewer',
                        sourcePath: '.opencode/agent/reviewer.md',
                        targetPath: '.opencode/agents/reviewer.md',
                        sharedFiles: ['.agents/skills/_shared/z.md', '.agents/skills/_shared/a.md'],
                        hash: { sha256: ' agent ', executable: false },
                    }],
                    sharedEntries: [{
                        sourcePath: '.agents/skills/_shared/z.md',
                        targetPath: '.agents/skills/_shared/z.md',
                        hash: { sha256: ' shared ', executable: true },
                        owners: ['subagent:reviewer', 'skill:code-implement'],
                    }],
                },
            },
        })).toEqual({
            schemaVersion: 6,
            agents: ['codex'],
            subagents: ['opencode'],
            sources: {
                upstream: {
                    mode: 'explicit',
                    listedAt: null,
                    skillEntries: [],
                    subagentEntries: [{
                        name: 'reviewer',
                        sourcePath: '.opencode/agent/reviewer.md',
                        targetPath: '.opencode/agents/reviewer.md',
                        sharedFiles: ['.agents/skills/_shared/a.md', '.agents/skills/_shared/z.md'],
                        hash: { sha256: 'agent', executable: false },
                    }],
                    sharedEntries: [{
                        sourcePath: '.agents/skills/_shared/z.md',
                        targetPath: '.agents/skills/_shared/z.md',
                        hash: { sha256: 'shared', executable: true },
                        owners: ['skill:code-implement', 'subagent:reviewer'],
                    }],
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
    });
});
