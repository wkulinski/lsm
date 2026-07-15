import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import Hashing from '../src/core/shared/Hashing';
import Sync from '../src/core/sync/SyncAdapter';
import { createTempDir } from './helpers';
import type {
    BackendLike,
    DiscoveredSources,
    LockData,
    LockSourceMeta,
    ManifestData,
    SharedFileContentEntry,
    SkillEntry,
    SyncPlan,
} from '../src/core/types';

interface FakeBackend extends BackendLike {
    installed: Parameters<BackendLike['installSkillEntries']>[0][];
    removed: Parameters<BackendLike['removeSkillEntries']>[0][];
}

interface FakeBackendOptions {
    root: string;
    agentSkillDirs: string[];
    sharedFiles?: Map<string, Buffer>;
    removeResults?: ReturnType<BackendLike['removeSkillEntries']>[];
}

describe('Sync', () => {
    test('plans removed agents and pruned managed skills from lock and discovery state', () => {
        const tempDir = createTempDir();

        try {
            const sync = new Sync({
                backend: createFakeBackend({
                    root: tempDir,
                    agentSkillDirs: [path.join(tempDir, '.agents', 'skills')],
                }),
                manifestStore: createManifestStore({
                    managedSkills: ['Alpha', 'Beta'],
                }),
            });
            const lock: LockData = {
                schemaVersion: 5,
                agents: ['codex', 'cursor'],
                sources: {
                    upstream: createLockSourceMeta({
                        skillEntries: [
                            createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' }),
                            createSkillEntry({ name: 'Beta', sourcePath: '.agents/skills/beta' }),
                        ],
                    }),
                },
            };
            const manifest: ManifestData = {
                agents: ['codex'],
                sources: [{ source: 'upstream', skills: null, publish: { branchPrefix: null, createPr: null } }],
            };
            const discovered: DiscoveredSources = {
                upstream: {
                    mode: 'all',
                    listedAt: '2026-06-05T00:00:00.000Z',
                    skills: ['Alpha'],
                    skillEntries: [createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' })],
                    sharedFileHashes: [],
                    missingRequested: [],
                    resolved: createResolvedMeta(),
                },
            };

            expect(sync.planRemovals({ lock, manifest, discovered })).toMatchObject({
                oldAgents: ['codex', 'cursor'],
                newAgents: ['codex'],
                agentsUnion: ['codex', 'cursor'],
                agentsRemoved: ['cursor'],
                oldManaged: ['Alpha', 'Beta'],
                newManaged: ['Alpha'],
                skillsRemoved: ['Beta'],
                skillsRemovedEntries: [{ name: 'Beta', sourcePath: '.agents/skills/beta' }],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('syncs declared shared files and prunes stale managed shared files', () => {
        const tempDir = createTempDir();

        try {
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            const staleFilePath = path.join(agentSkillDir, 'shared', 'stale.md');
            fs.mkdirSync(path.dirname(staleFilePath), { recursive: true });
            fs.writeFileSync(staleFilePath, '# Stale\n', 'utf8');
            const currentSourcePath = '.agents/skills/shared/current.md';
            const currentContent = Buffer.from('# Current\n');
            const backend = createFakeBackend({
                root: tempDir,
                agentSkillDirs: [agentSkillDir],
                sharedFiles: new Map([[currentSourcePath, currentContent]]),
            });
            const sync = new Sync({
                backend,
                manifestStore: createManifestStore({
                    managedSharedFilesBySource: {
                        upstream: ['.agents/skills/shared/stale.md'],
                    },
                }),
            });
            const manifest: ManifestData = {
                agents: ['codex'],
                sources: [{ source: 'upstream', skills: null, publish: { branchPrefix: null, createPr: null } }],
            };
            const lock: LockData = {
                schemaVersion: 5,
                agents: ['codex'],
                sources: {
                    upstream: createLockSourceMeta({
                        skillEntries: [createSkillEntry({
                            name: 'Example',
                            sourcePath: '.agents/skills/example',
                            sharedFiles: ['.agents/skills/shared/stale.md'],
                        })],
                    }),
                },
            };
            const discovered: DiscoveredSources = {
                upstream: {
                    mode: 'all',
                    listedAt: '2026-06-05T00:00:00.000Z',
                    skills: ['Example'],
                    skillEntries: [createSkillEntry({
                        name: 'Example',
                        sourcePath: '.agents/skills/example',
                        sharedFiles: [currentSourcePath],
                    })],
                    sharedFileHashes: [],
                    missingRequested: [],
                    resolved: createResolvedMeta(),
                },
            };

            const result = sync.syncSharedFilesPhase({ manifest, lock, discovered });

            expect(result.sharedFailed).toBe(false);
            expect(result.managedNewLocalPaths).toEqual({
                upstream: ['.agents/skills/shared/current.md'],
            });
            expect(result.sharedStats).toEqual({
                upstream: { declaredFiles: 1, copiedFiles: 1 },
            });
            expect(result.sharedFileHashesBySource.upstream).toEqual([{
                path: currentSourcePath,
                sha256: Hashing.sha256Buffer(currentContent),
            }]);
            expect(result.removedFiles).toBe(1);
            expect(fs.readFileSync(path.join(agentSkillDir, 'shared', 'current.md'), 'utf8')).toBe('# Current\n');
            expect(fs.existsSync(staleFilePath)).toBe(false);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('detects local modifications of managed skill files before overwrite', () => {
        const tempDir = createTempDir();

        try {
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            const baselineSkillDir = path.join(tempDir, 'baseline', 'example');
            const localSkillDir = path.join(agentSkillDir, 'example');
            fs.mkdirSync(baselineSkillDir, { recursive: true });
            fs.mkdirSync(localSkillDir, { recursive: true });
            fs.writeFileSync(path.join(baselineSkillDir, 'SKILL.md'), '# Original\n', 'utf8');
            fs.writeFileSync(path.join(localSkillDir, 'SKILL.md'), '# Modified\n', 'utf8');
            const baselineHash = Hashing.hashDirectory(baselineSkillDir);
            expect(baselineHash).not.toBeNull();

            const sync = new Sync({
                backend: createFakeBackend({
                    root: tempDir,
                    agentSkillDirs: [agentSkillDir],
                }),
                manifestStore: createManifestStore(),
            });
            const skillEntry = createSkillEntry({
                name: 'Example',
                sourcePath: '.agents/skills/example',
                hash: baselineHash,
            });
            const lock: LockData = {
                schemaVersion: 5,
                agents: ['codex'],
                sources: {
                    upstream: createLockSourceMeta({
                        skillEntries: [skillEntry],
                    }),
                },
            };
            const manifest: ManifestData = {
                agents: ['codex'],
                sources: [{ source: 'upstream', skills: null, publish: { branchPrefix: null, createPr: null } }],
            };
            const discovered: DiscoveredSources = {
                upstream: {
                    mode: 'all',
                    listedAt: '2026-06-05T00:00:00.000Z',
                    skills: ['Example'],
                    skillEntries: [skillEntry],
                    sharedFileHashes: [],
                    missingRequested: [],
                    resolved: createResolvedMeta(),
                },
            };

            expect(sync.collectLocalChangeConflicts({
                manifest,
                lock,
                discovered,
                plan: {
                    agentsUnion: ['codex'],
                    skillsRemoved: [],
                },
            })).toEqual({
                ok: true,
                conflicts: [{
                    path: '.agents/skills/example/SKILL.md',
                    reason: 'modified-managed',
                    operation: 'overwrite',
                    scope: 'skill-file',
                    source: 'upstream',
                    skill: 'Example',
                }],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('removes managed skills from agents removed from manifest', () => {
        const tempDir = createTempDir();

        try {
            const backend = createFakeBackend({
                root: tempDir,
                agentSkillDirs: [path.join(tempDir, '.agents', 'skills')],
            });
            const sync = new Sync({
                backend,
                manifestStore: createManifestStore(),
            });

            expect(sync.removePhase(createSyncPlan({
                agentsRemoved: ['cursor'],
                oldManaged: ['Alpha', 'Beta'],
                oldManagedEntries: [
                    { name: 'Alpha', sourcePath: '.agents/skills/alpha' },
                    { name: 'Beta', sourcePath: '.agents/skills/beta' },
                ],
            }))).toEqual({
                removedFromRemovedAgents: 2,
                prunedSkills: 0,
                removedAgents: ['cursor'],
                agentsUnion: ['codex', 'cursor'],
                hadNothingToPrune: true,
            });
            expect(backend.removed).toEqual([{
                agents: ['cursor'],
                skillEntries: [
                    { name: 'Alpha', sourcePath: '.agents/skills/alpha' },
                    { name: 'Beta', sourcePath: '.agents/skills/beta' },
                ],
            }]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('prunes removed managed skills from all relevant agents', () => {
        const tempDir = createTempDir();

        try {
            const backend = createFakeBackend({
                root: tempDir,
                agentSkillDirs: [path.join(tempDir, '.agents', 'skills')],
            });
            const sync = new Sync({
                backend,
                manifestStore: createManifestStore(),
            });

            expect(sync.removePhase(createSyncPlan({
                oldManaged: ['Alpha', 'Beta'],
                oldManagedEntries: [
                    { name: 'Alpha', sourcePath: '.agents/skills/alpha' },
                    { name: 'Beta', sourcePath: '.agents/skills/beta' },
                ],
                skillsRemoved: ['Beta'],
                skillsRemovedEntries: [
                    { name: 'Beta', sourcePath: '.agents/skills/beta' },
                ],
            }))).toEqual({
                removedFromRemovedAgents: 2,
                prunedSkills: 1,
                removedAgents: [],
                agentsUnion: ['codex', 'cursor'],
                hadNothingToPrune: false,
            });
            expect(backend.removed).toEqual([{
                agents: ['codex', 'cursor'],
                skillEntries: [
                    { name: 'Beta', sourcePath: '.agents/skills/beta' },
                ],
            }]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('does not call backend when removal plan is empty', () => {
        const tempDir = createTempDir();

        try {
            const backend = createFakeBackend({
                root: tempDir,
                agentSkillDirs: [path.join(tempDir, '.agents', 'skills')],
            });
            const sync = new Sync({
                backend,
                manifestStore: createManifestStore(),
            });

            expect(sync.removePhase(createSyncPlan())).toEqual({
                removedFromRemovedAgents: 0,
                prunedSkills: 0,
                removedAgents: [],
                agentsUnion: ['codex', 'cursor'],
                hadNothingToPrune: true,
            });
            expect(backend.removed).toEqual([]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('throws when backend fails while pruning removed managed skills', () => {
        const tempDir = createTempDir();

        try {
            const backend = createFakeBackend({
                root: tempDir,
                agentSkillDirs: [path.join(tempDir, '.agents', 'skills')],
                removeResults: [{
                    ok: false,
                    status: 1,
                    cmd: ['fake-remove', 'Beta'],
                    error: 'remove failed',
                    details: 'backend details',
                }],
            });
            const sync = new Sync({
                backend,
                manifestStore: createManifestStore(),
            });

            expect(() => sync.removePhase(createSyncPlan({
                skillsRemoved: ['Beta'],
                skillsRemovedEntries: [
                    { name: 'Beta', sourcePath: '.agents/skills/beta' },
                ],
            }))).toThrow('Failed while pruning removed or missing skills.');
            expect(backend.removed).toEqual([{
                agents: ['codex', 'cursor'],
                skillEntries: [
                    { name: 'Beta', sourcePath: '.agents/skills/beta' },
                ],
            }]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

function createFakeBackend({ root, agentSkillDirs, sharedFiles = new Map(), removeResults = [] }: FakeBackendOptions): FakeBackend {
    const installed: FakeBackend['installed'] = [];
    const removed: FakeBackend['removed'] = [];
    const queuedRemoveResults = [...removeResults];

    return {
        root,
        installed,
        removed,
        listSkills(): ReturnType<BackendLike['listSkills']> {
            return { ok: false, error: 'listSkills is not implemented in this test backend' };
        },
        resolveSource(): ReturnType<BackendLike['resolveSource']> {
            return { ok: false, error: 'resolveSource is not implemented in this test backend' };
        },
        collectSharedFiles(source: string, sharedFilePaths: string[]): ReturnType<BackendLike['collectSharedFiles']> {
            expect(source).toBe('upstream');
            const files: SharedFileContentEntry[] = [];
            for (const filePath of sharedFilePaths) {
                const content = sharedFiles.get(filePath);
                if (!content) {
                    return { ok: false, error: `Missing shared fixture: ${filePath}` };
                }
                files.push({ path: filePath, content });
            }

            return {
                ok: true,
                files,
            };
        },
        collectSkillDirectories(): ReturnType<NonNullable<BackendLike['collectSkillDirectories']>> {
            return { ok: false, error: 'collectSkillDirectories is not implemented in this test backend' };
        },
        resolveAgentProjectSkillDirs(): ReturnType<BackendLike['resolveAgentProjectSkillDirs']> {
            return { ok: true, dirs: agentSkillDirs };
        },
        installSkillEntries(input: Parameters<BackendLike['installSkillEntries']>[0]): ReturnType<BackendLike['installSkillEntries']> {
            installed.push(input);
            return { ok: true, status: 0, cmd: ['fake-install'] };
        },
        removeSkillEntries(input: Parameters<BackendLike['removeSkillEntries']>[0]): ReturnType<BackendLike['removeSkillEntries']> {
            removed.push(input);
            return queuedRemoveResults.shift() ?? { ok: true, status: 0, cmd: ['fake-remove'] };
        },
    };
}

function createSyncPlan({
    oldAgents = ['codex', 'cursor'],
    newAgents = ['codex', 'cursor'],
    agentsUnion = ['codex', 'cursor'],
    agentsRemoved = [],
    oldManaged = [],
    oldManagedEntries = [],
    newManaged = [],
    skillsRemoved = [],
    skillsRemovedEntries = [],
}: Partial<SyncPlan> = {}): SyncPlan {
    return {
        oldAgents,
        newAgents,
        agentsUnion,
        agentsRemoved,
        oldManaged,
        oldManagedEntries,
        newManaged,
        skillsRemoved,
        skillsRemovedEntries,
    };
}

function createManifestStore({
    managedSkills = [],
    managedSharedFilesBySource = {},
}: {
    managedSkills?: string[];
    managedSharedFilesBySource?: { [key: string]: string[] };
} = {}): ConstructorParameters<typeof Sync>[0]['manifestStore'] {
    return {
        lockManagedSkills(): string[] {
            return managedSkills;
        },
        lockManagedSharedFilesBySource(): { [key: string]: string[] } {
            return managedSharedFilesBySource;
        },
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
