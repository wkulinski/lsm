import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import Hashing from '../src/core/shared/Hashing';
import SyncPreflightConflicts from '../src/core/sync/SyncPreflightConflicts';
import { createTempDir } from './helpers';
import type {
    BackendLike,
    DiscoveredSources,
    LockData,
    LockSourceMeta,
    ManifestData,
    SharedFileContentEntry,
    SkillEntry,
} from '../src/core/types';

describe('SyncPreflightConflicts', () => {
    test('detects modified managed shared files before overwrite', () => {
        const tempDir = createTempDir();

        try {
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            const sharedSourcePath = '.agents/skills/shared/current.md';
            const localSharedPath = path.join(tempDir, sharedSourcePath);
            fs.mkdirSync(path.dirname(localSharedPath), { recursive: true });
            fs.writeFileSync(localSharedPath, '# Modified\n', 'utf8');

            const result = createPreflight({ root: tempDir, agentSkillDirs: [agentSkillDir] }).collectLocalChangeConflicts({
                manifest: createManifest(),
                lock: createLock({
                    sources: {
                        upstream: createLockSourceMeta({
                            skillEntries: [createSkillEntry({
                                name: 'Alpha',
                                sourcePath: '.agents/skills/alpha',
                            })],
                            sharedFileHashes: [{
                                path: sharedSourcePath,
                                sha256: Hashing.sha256Buffer(Buffer.from('# Original\n')),
                            }],
                        }),
                    },
                }),
                discovered: {
                    upstream: createDiscoveredSource({
                        skillEntries: [createSkillEntry({
                            name: 'Alpha',
                            sourcePath: '.agents/skills/alpha',
                            sharedFiles: [sharedSourcePath],
                        })],
                    }),
                },
                plan: { agentsUnion: ['codex'], skillsRemoved: [] },
            });

            expect(result).toEqual({
                ok: true,
                conflicts: [{
                    path: sharedSourcePath,
                    reason: 'modified-managed',
                    operation: 'overwrite',
                    scope: 'shared',
                    source: 'upstream',
                    skill: null,
                }],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('reports missing baseline hashes for existing managed shared files', () => {
        const tempDir = createTempDir();

        try {
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            const sharedSourcePath = '.agents/skills/shared/current.md';
            const localSharedPath = path.join(tempDir, sharedSourcePath);
            fs.mkdirSync(path.dirname(localSharedPath), { recursive: true });
            fs.writeFileSync(localSharedPath, '# Current\n', 'utf8');

            const result = createPreflight({ root: tempDir, agentSkillDirs: [agentSkillDir] }).collectLocalChangeConflicts({
                manifest: createManifest(),
                lock: createLock({
                    sources: {
                        upstream: createLockSourceMeta({
                            skillEntries: [createSkillEntry({
                                name: 'Alpha',
                                sourcePath: '.agents/skills/alpha',
                                sharedFiles: [sharedSourcePath],
                            })],
                            sharedFileHashes: [],
                        }),
                    },
                }),
                discovered: {
                    upstream: createDiscoveredSource({
                        skillEntries: [createSkillEntry({
                            name: 'Alpha',
                            sourcePath: '.agents/skills/alpha',
                            sharedFiles: [sharedSourcePath],
                        })],
                    }),
                },
                plan: { agentsUnion: ['codex'], skillsRemoved: [] },
            });

            expect(result).toEqual({
                ok: true,
                conflicts: [{
                    path: sharedSourcePath,
                    reason: 'missing-baseline-hash',
                    operation: 'overwrite',
                    scope: 'shared',
                    source: 'upstream',
                    skill: null,
                }],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('detects unmanaged existing shared files before overwrite', () => {
        const tempDir = createTempDir();

        try {
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            const sharedSourcePath = '.agents/skills/shared/current.md';
            const localSharedPath = path.join(tempDir, sharedSourcePath);
            fs.mkdirSync(path.dirname(localSharedPath), { recursive: true });
            fs.writeFileSync(localSharedPath, '# Local\n', 'utf8');

            const result = createPreflight({ root: tempDir, agentSkillDirs: [agentSkillDir] }).collectLocalChangeConflicts({
                manifest: createManifest(),
                lock: createLock(),
                discovered: {
                    upstream: createDiscoveredSource({
                        skillEntries: [createSkillEntry({
                            name: 'Alpha',
                            sourcePath: '.agents/skills/alpha',
                            sharedFiles: [sharedSourcePath],
                        })],
                    }),
                },
            });

            expect(result).toEqual({
                ok: true,
                conflicts: [{
                    path: sharedSourcePath,
                    reason: 'unmanaged-existing-path',
                    operation: 'overwrite',
                    scope: 'shared',
                    source: null,
                    skill: null,
                }],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('detects unmanaged existing skill directories before overwrite', () => {
        const tempDir = createTempDir();

        try {
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            const localSkillDir = path.join(agentSkillDir, 'alpha');
            fs.mkdirSync(localSkillDir, { recursive: true });
            fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), '# Local\n', 'utf8');

            const result = createPreflight({ root: tempDir, agentSkillDirs: [agentSkillDir] }).collectLocalChangeConflicts({
                manifest: createManifest(),
                lock: createLock(),
                discovered: {
                    upstream: createDiscoveredSource({
                        skillEntries: [createSkillEntry({
                            name: 'Alpha',
                            sourcePath: '.agents/skills/alpha',
                        })],
                    }),
                },
            });

            expect(result).toEqual({
                ok: true,
                conflicts: [{
                    path: '.agents/skills/alpha',
                    reason: 'unmanaged-existing-path',
                    operation: 'overwrite',
                    scope: 'skill',
                    source: null,
                    skill: null,
                }],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

function createPreflight({ root, agentSkillDirs }: { root: string; agentSkillDirs: string[] }): SyncPreflightConflicts {
    return new SyncPreflightConflicts({
        backend: createFakeBackend({ root, agentSkillDirs }),
    });
}

function createFakeBackend({ root, agentSkillDirs }: { root: string; agentSkillDirs: string[] }): BackendLike {
    return {
        root,
        listSkills(): ReturnType<BackendLike['listSkills']> {
            return { ok: false, error: 'listSkills is not implemented in this test backend' };
        },
        resolveSource(): ReturnType<BackendLike['resolveSource']> {
            return { ok: false, error: 'resolveSource is not implemented in this test backend' };
        },
        collectSharedFiles(): ReturnType<BackendLike['collectSharedFiles']> {
            const files: SharedFileContentEntry[] = [];
            return { ok: true, files };
        },
        resolveAgentProjectSkillDirs(): ReturnType<BackendLike['resolveAgentProjectSkillDirs']> {
            return { ok: true, dirs: agentSkillDirs };
        },
        installSkillEntries(): ReturnType<BackendLike['installSkillEntries']> {
            return { ok: true, status: 0, cmd: ['fake-install'] };
        },
        removeSkillEntries(): ReturnType<BackendLike['removeSkillEntries']> {
            return { ok: true, status: 0, cmd: ['fake-remove'] };
        },
    };
}

function createManifest({ agents = ['codex'] }: { agents?: string[] } = {}): ManifestData {
    return {
        agents,
        sources: [{ source: 'upstream', skills: null, publish: { branchPrefix: null, createPr: null } }],
    };
}

function createLock({ agents = ['codex'], sources = {} }: { agents?: string[]; sources?: LockData['sources'] } = {}): LockData {
    return {
        schemaVersion: 5,
        agents,
        sources,
    };
}

function createDiscoveredSource({ skillEntries }: { skillEntries: SkillEntry[] }): DiscoveredSources[string] {
    return {
        mode: 'all',
        listedAt: '2026-06-05T00:00:00.000Z',
        skills: skillEntries.map(entry => entry.name),
        skillEntries,
        sharedFileHashes: [],
        missingRequested: [],
        resolved: createResolvedMeta(),
    };
}

function createSkillEntry(
    {
        name,
        sourcePath,
        sharedFiles = [],
        hash = null,
    }: {
        name: string;
        sourcePath: string;
        sharedFiles?: string[];
        hash?: SkillEntry['hash'];
    },
): SkillEntry {
    return {
        name,
        sourcePath,
        sharedFiles,
        hash,
    };
}

function createLockSourceMeta({ skillEntries = [], sharedFileHashes = [] }: Partial<LockSourceMeta> = {}): LockSourceMeta {
    return {
        mode: 'all',
        listedAt: '2026-06-05T00:00:00.000Z',
        skillEntries,
        sharedFileHashes,
        resolved: createResolvedMeta(),
    };
}

function createResolvedMeta(): LockSourceMeta['resolved'] {
    return {
        requestedRef: null,
        defaultBranch: 'main',
        resolvedRef: 'main',
        resolvedCommit: 'abc123',
        subpath: null,
        resolvedAt: '2026-06-05T00:00:00.000Z',
    };
}
