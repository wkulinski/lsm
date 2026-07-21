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

    test.each([
        { baseline: '# Original\n', expected: 'modified-managed' },
        { baseline: null, expected: 'missing-baseline-hash' },
    ])('preserves the guard for a shared path that is not a file', ({ baseline, expected }) => {
        const scenario = createNonFileSharedConflictScenario({ baseline });

        try {
            expect(scenario.result.conflicts.map(conflict => conflict.reason)).toEqual([expected]);
        }
        finally {
            fs.rmSync(scenario.root, { recursive: true, force: true });
        }
    });

    test('keeps the unmanaged-path guard for a new shared file', () => {
        const root = createTempDir();
        const agentSkillDir = path.join(root, '.agents', 'skills');
        const sharedPath = '.agents/skills/shared/new.md';
        const localPath = path.join(root, sharedPath);
        const skillEntry = createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' });
        const targetSkillEntry = createSkillEntry({
            name: 'Alpha',
            sourcePath: '.agents/skills/alpha',
            sharedFiles: [sharedPath],
        });
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, '# Upstream\n', 'utf8');

        try {
            const result = createPreflight({ root, agentSkillDirs: [agentSkillDir] }).collectLocalChangeConflicts({
                manifest: createManifest(),
                lock: createLock({
                    sources: {
                        upstream: createLockSourceMeta({ skillEntries: [skillEntry] }),
                    },
                }),
                discovered: {
                    upstream: createDiscoveredSource({
                        skillEntries: [targetSkillEntry],
                        sharedFileHashes: [{
                            path: sharedPath,
                            sha256: Hashing.sha256Buffer(Buffer.from('# Upstream\n')),
                        }],
                    }),
                },
                plan: { agentsUnion: ['codex'], skillsRemoved: [] },
            });

            expect(result.conflicts).toEqual([{
                path: sharedPath,
                reason: 'unmanaged-existing-path',
                operation: 'overwrite',
                scope: 'shared',
                source: null,
                skill: null,
            }]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('does not accept a modified skill when the target hash is unavailable', () => {
        const scenario = createSkillConflictScenario({
            baseline: '# Original\n',
            local: '# Local\n',
            target: '# Upstream\n',
            targetHash: false,
        });

        try {
            expect(scenario.result.conflicts.map(conflict => conflict.reason)).toEqual(['modified-managed']);
        }
        finally {
            fs.rmSync(scenario.root, { recursive: true, force: true });
        }
    });

    test('does not accept a modified shared file when the target hash is unavailable', () => {
        const scenario = createSharedConflictScenario({
            baseline: '# Original\n',
            local: '# Local\n',
            target: '# Upstream\n',
            targetHash: false,
        });

        try {
            expect(scenario.result.conflicts.map(conflict => conflict.reason)).toEqual(['modified-managed']);
        }
        finally {
            fs.rmSync(scenario.root, { recursive: true, force: true });
        }
    });

    test('does not match a target skill by name when its source path differs', () => {
        const scenario = createSkillConflictScenario({
            baseline: '# Original\n',
            local: '# Local\n',
            target: '# Upstream\n',
            targetSourcePath: '.agents/skills/beta',
        });

        try {
            expect(scenario.result.conflicts).toEqual([{
                path: '.agents/skills/example/SKILL.md',
                reason: 'modified-managed',
                operation: 'overwrite',
                scope: 'skill-file',
                source: 'upstream',
                skill: 'Alpha',
            }]);
        }
        finally {
            fs.rmSync(scenario.root, { recursive: true, force: true });
        }
    });

    test.each([
        { local: '# Original\n', expected: [] },
        { local: '# Local\n', expected: ['modified-managed'] },
    ])('protects a removed shared file when local content is $local', ({ local, expected }) => {
        const scenario = createSharedConflictScenario({
            baseline: '# Original\n',
            local,
            target: '# Upstream\n',
            targetSharedFile: false,
        });

        try {
            expect(scenario.result.conflicts.map(conflict => conflict.reason)).toEqual(expected);
        }
        finally {
            fs.rmSync(scenario.root, { recursive: true, force: true });
        }
    });

    test.each([
        { local: '# Original\n', expected: [] },
        { local: '# Local\n', expected: ['modified-managed'] },
    ])('protects a removed skill when local content is $local', ({ local, expected }) => {
        const scenario = createRemovedSkillConflictScenario({ local });

        try {
            expect(scenario.result.conflicts.map(conflict => conflict.reason)).toEqual(expected);
        }
        finally {
            fs.rmSync(scenario.root, { recursive: true, force: true });
        }
    });

    test('accepts matching upstream content across all agent copies', () => {
        const root = createTempDir();
        const agentSkillDirs = [
            path.join(root, '.agents', 'skills'),
            path.join(root, '.cursor', 'skills'),
        ];
        const sourcePath = '.agents/skills/example';
        const targetDir = path.join(root, 'target', 'example');
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'SKILL.md'), '# Upstream\n', 'utf8');

        agentSkillDirs.forEach((agentSkillDir) => {
            const localSkillDir = path.join(agentSkillDir, 'example');
            fs.mkdirSync(localSkillDir, { recursive: true });
            fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), '# Upstream\n', 'utf8');
        });

        try {
            const baselineDir = path.join(root, 'baseline', 'example');
            fs.mkdirSync(baselineDir, { recursive: true });
            fs.writeFileSync(path.join(baselineDir, 'SKILL.md'), '# Original\n', 'utf8');
            const result = createPreflight({ root, agentSkillDirs }).collectLocalChangeConflicts({
                manifest: createManifest({ agents: ['codex', 'cursor'] }),
                lock: createLock({
                    agents: ['codex', 'cursor'],
                    sources: {
                        upstream: createLockSourceMeta({
                            skillEntries: [createSkillEntry({
                                name: 'Alpha',
                                sourcePath,
                                hash: Hashing.hashDirectory(baselineDir),
                            })],
                        }),
                    },
                }),
                discovered: {
                    upstream: createDiscoveredSource({
                        skillEntries: [createSkillEntry({
                            name: 'Alpha',
                            sourcePath,
                            hash: Hashing.hashDirectory(targetDir),
                        })],
                    }),
                },
                plan: { agentsUnion: ['codex', 'cursor'], skillsRemoved: [] },
            });

            expect(result.conflicts).toEqual([]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test.each([
        {
            name: 'installs upstream when local content still matches the baseline',
            baseline: '# Original\n',
            local: '# Original\n',
            target: '# Upstream\n',
            expected: [],
        },
        {
            name: 'does not report a local file already matching upstream',
            baseline: '# Original\n',
            local: '# Upstream\n',
            target: '# Upstream\n',
            expected: [],
        },
        {
            name: 'reports a local file differing from both baseline and upstream',
            baseline: '# Original\n',
            local: '# Local\n',
            target: '# Upstream\n',
            expected: ['modified-managed'],
        },
        {
            name: 'accepts upstream content when the baseline hash is missing',
            baseline: null,
            local: '# Upstream\n',
            target: '# Upstream\n',
            expected: [],
        },
        {
            name: 'reports a missing baseline when local content differs from upstream',
            baseline: null,
            local: '# Local\n',
            target: '# Upstream\n',
            expected: ['missing-baseline-hash'],
        },
    ])('handles skill three-way state: $name', ({ baseline, local, target, expected }) => {
        const scenario = createSkillConflictScenario({ baseline, local, target });

        try {
            expect(scenario.result.conflicts.map(conflict => conflict.reason)).toEqual(expected);
        }
        finally {
            fs.rmSync(scenario.root, { recursive: true, force: true });
        }
    });

    test.each([
        {
            name: 'installs upstream when local content still matches the baseline',
            baseline: '# Original\n',
            local: '# Original\n',
            target: '# Upstream\n',
            expected: [],
        },
        {
            name: 'does not report a local file already matching upstream',
            baseline: '# Original\n',
            local: '# Upstream\n',
            target: '# Upstream\n',
            expected: [],
        },
        {
            name: 'reports a local file differing from both baseline and upstream',
            baseline: '# Original\n',
            local: '# Local\n',
            target: '# Upstream\n',
            expected: ['modified-managed'],
        },
        {
            name: 'accepts upstream content when the baseline hash is missing',
            baseline: null,
            local: '# Upstream\n',
            target: '# Upstream\n',
            expected: [],
        },
        {
            name: 'reports a missing baseline when local content differs from upstream',
            baseline: null,
            local: '# Local\n',
            target: '# Upstream\n',
            expected: ['missing-baseline-hash'],
        },
    ])('handles shared file three-way state: $name', ({ baseline, local, target, expected }) => {
        const scenario = createSharedConflictScenario({ baseline, local, target });

        try {
            expect(scenario.result.conflicts.map(conflict => conflict.reason)).toEqual(expected);
        }
        finally {
            fs.rmSync(scenario.root, { recursive: true, force: true });
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

function createSkillConflictScenario({
    baseline,
    local,
    target,
    targetHash = true,
    targetSourcePath,
}: {
    baseline: string | null;
    local: string;
    target: string;
    targetHash?: boolean;
    targetSourcePath?: string;
}): {
    root: string;
    result: ReturnType<SyncPreflightConflicts['collectLocalChangeConflicts']>;
} {
    const root = createTempDir();
    const agentSkillDir = path.join(root, '.agents', 'skills');
    const localSkillDir = path.join(agentSkillDir, 'example');
    const baselineDir = path.join(root, 'baseline', 'example');
    const targetDir = path.join(root, 'target', 'example');
    const sourcePath = '.agents/skills/example';
    const effectiveTargetSourcePath = targetSourcePath ?? sourcePath;

    fs.mkdirSync(localSkillDir, { recursive: true });
    fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), local, 'utf8');
    if (baseline !== null) {
        fs.mkdirSync(baselineDir, { recursive: true });
        fs.writeFileSync(path.join(baselineDir, 'SKILL.md'), baseline, 'utf8');
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), target, 'utf8');

    const baselineEntry = createSkillEntry({
        name: 'Alpha',
        sourcePath,
        hash: baseline === null ? null : Hashing.hashDirectory(baselineDir),
    });
    const targetEntry = createSkillEntry({
        name: 'Alpha',
        sourcePath: effectiveTargetSourcePath,
        hash: targetHash ? Hashing.hashDirectory(targetDir) : null,
    });

    return {
        root,
        result: createPreflight({ root, agentSkillDirs: [agentSkillDir] }).collectLocalChangeConflicts({
            manifest: createManifest(),
            lock: createLock({
                sources: {
                    upstream: createLockSourceMeta({ skillEntries: [baselineEntry] }),
                },
            }),
            discovered: {
                upstream: createDiscoveredSource({ skillEntries: [targetEntry] }),
            },
            plan: { agentsUnion: ['codex'], skillsRemoved: [] },
        }),
    };
}

function createRemovedSkillConflictScenario({ local }: { local: string }): {
    root: string;
    result: ReturnType<SyncPreflightConflicts['collectLocalChangeConflicts']>;
} {
    const root = createTempDir();
    const agentSkillDir = path.join(root, '.agents', 'skills');
    const localSkillDir = path.join(agentSkillDir, 'example');
    const baselineDir = path.join(root, 'baseline', 'example');
    fs.mkdirSync(localSkillDir, { recursive: true });
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), local, 'utf8');
    fs.writeFileSync(path.join(baselineDir, 'SKILL.md'), '# Original\n', 'utf8');

    return {
        root,
        result: createPreflight({ root, agentSkillDirs: [agentSkillDir] }).collectLocalChangeConflicts({
            manifest: createManifest(),
            lock: createLock({
                sources: {
                    upstream: createLockSourceMeta({
                        skillEntries: [createSkillEntry({
                            name: 'Alpha',
                            sourcePath: '.agents/skills/example',
                            hash: Hashing.hashDirectory(baselineDir),
                        })],
                    }),
                },
            }),
            discovered: {
                upstream: createDiscoveredSource({ skillEntries: [] }),
            },
            plan: { agentsUnion: ['codex'], skillsRemoved: ['Alpha'] },
        }),
    };
}

function createNonFileSharedConflictScenario({ baseline }: { baseline: string | null }): {
    root: string;
    result: ReturnType<SyncPreflightConflicts['collectLocalChangeConflicts']>;
} {
    const root = createTempDir();
    const agentSkillDir = path.join(root, '.agents', 'skills');
    const sharedPath = '.agents/skills/shared/current.md';
    const localPath = path.join(root, sharedPath);
    const skillEntry = createSkillEntry({
        name: 'Alpha',
        sourcePath: '.agents/skills/alpha',
        sharedFiles: [sharedPath],
    });
    fs.mkdirSync(localPath, { recursive: true });

    return {
        root,
        result: createPreflight({ root, agentSkillDirs: [agentSkillDir] }).collectLocalChangeConflicts({
            manifest: createManifest(),
            lock: createLock({
                sources: {
                    upstream: createLockSourceMeta({
                        skillEntries: [skillEntry],
                        sharedFileHashes: baseline === null
                            ? []
                            : [{ path: sharedPath, sha256: Hashing.sha256Buffer(Buffer.from(baseline)) }],
                    }),
                },
            }),
            discovered: {
                upstream: createDiscoveredSource({
                    skillEntries: [skillEntry],
                    sharedFileHashes: [{ path: sharedPath, sha256: Hashing.sha256Buffer(Buffer.from('# Upstream\n')) }],
                }),
            },
            plan: { agentsUnion: ['codex'], skillsRemoved: [] },
        }),
    };
}

function createSharedConflictScenario({
    baseline,
    local,
    target,
    targetHash = true,
    targetSharedFile = true,
}: {
    baseline: string | null;
    local: string;
    target: string;
    targetHash?: boolean;
    targetSharedFile?: boolean;
}): {
    root: string;
    result: ReturnType<SyncPreflightConflicts['collectLocalChangeConflicts']>;
} {
    const root = createTempDir();
    const agentSkillDir = path.join(root, '.agents', 'skills');
    const sharedPath = '.agents/skills/shared/current.md';
    const localPath = path.join(root, sharedPath);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, local, 'utf8');

    const skillEntry = createSkillEntry({
        name: 'Alpha',
        sourcePath: '.agents/skills/alpha',
        sharedFiles: [sharedPath],
    });
    const targetSkillEntry = createSkillEntry({
        name: 'Alpha',
        sourcePath: '.agents/skills/alpha',
        sharedFiles: targetSharedFile ? [sharedPath] : [],
    });
    const baselineSharedFileHashes = baseline === null
        ? []
        : [{ path: sharedPath, sha256: Hashing.sha256Buffer(Buffer.from(baseline)) }];
    const targetSharedFileHashes = targetHash && targetSharedFile
        ? [{ path: sharedPath, sha256: Hashing.sha256Buffer(Buffer.from(target)) }]
        : [];

    return {
        root,
        result: createPreflight({ root, agentSkillDirs: [agentSkillDir] }).collectLocalChangeConflicts({
            manifest: createManifest(),
            lock: createLock({
                sources: {
                    upstream: createLockSourceMeta({
                        skillEntries: [skillEntry],
                        sharedFileHashes: baselineSharedFileHashes,
                    }),
                },
            }),
            discovered: {
                upstream: createDiscoveredSource({
                    skillEntries: [targetSkillEntry],
                    sharedFileHashes: targetSharedFileHashes,
                }),
            },
            plan: { agentsUnion: ['codex'], skillsRemoved: [] },
        }),
    };
}

function createDiscoveredSource({ skillEntries, sharedFileHashes = [] }: { skillEntries: SkillEntry[]; sharedFileHashes?: { path: string; sha256: string }[] }): DiscoveredSources[string] {
    return {
        mode: 'all',
        listedAt: '2026-06-05T00:00:00.000Z',
        skills: skillEntries.map(entry => entry.name),
        skillEntries,
        sharedFileHashes,
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
