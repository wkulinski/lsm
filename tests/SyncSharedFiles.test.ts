import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import Hashing from '../src/core/shared/Hashing';
import SyncSharedFiles from '../src/core/sync/SyncSharedFiles';
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

interface FakeBackendOptions {
    root: string;
    agentSkillDirs: string[];
    sharedFiles?: Map<string, Buffer>;
    sharedFileEntries?: Map<string, SharedFileContentEntry>;
}

describe('SyncSharedFiles', () => {
    test('reports ownership conflicts when two sources manage the same local shared file', () => {
        const tempDir = createTempDir();

        try {
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            const sharedSourcePath = '.agents/skills/shared/common.md';
            const syncSharedFiles = createSyncSharedFiles({
                root: tempDir,
                agentSkillDirs: [agentSkillDir],
                sharedFiles: new Map([[sharedSourcePath, Buffer.from('# Common\n')]]),
            });

            const result = syncSharedFiles.syncSharedFilesPhase({
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
                    fork: createDiscoveredSource({
                        skillEntries: [createSkillEntry({
                            name: 'Beta',
                            sourcePath: '.agents/skills/beta',
                            sharedFiles: [sharedSourcePath],
                        })],
                    }),
                },
            });

            expect(result.sharedFailed).toBe(true);
            expect(result.errors).toEqual([{
                message: 'Shared file ownership conflicts detected.',
                details: [{ filePath: sharedSourcePath, a: 'upstream', b: 'fork' }],
            }]);
            expect(result.managedNewLocalPaths).toEqual({
                upstream: [sharedSourcePath],
                fork: [sharedSourcePath],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('returns a source-scoped error when shared file collection fails', () => {
        const tempDir = createTempDir();

        try {
            const syncSharedFiles = createSyncSharedFiles({
                root: tempDir,
                agentSkillDirs: [path.join(tempDir, '.agents', 'skills')],
            });
            const sharedSourcePath = '.agents/skills/shared/missing.md';

            const result = syncSharedFiles.syncSharedFilesPhase({
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

            expect(result).toMatchObject({
                sharedFailed: true,
                managedNewLocalPaths: { upstream: [] },
                sharedStats: { upstream: { declaredFiles: 1, copiedFiles: 0 } },
                sharedFileHashesBySource: { upstream: [] },
                errors: [{
                    source: 'upstream',
                    message: 'Error while collecting shared files for source.',
                    details: `Missing shared fixture: ${sharedSourcePath}`,
                }],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('does not write shared files through a symlinked agent directory', () => {
        const tempDir = createTempDir();

        try {
            const outsideDir = path.join(tempDir, 'outside');
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            const sharedSourcePath = '.agents/skills/shared/common.md';
            fs.mkdirSync(outsideDir, { recursive: true });
            fs.mkdirSync(path.dirname(agentSkillDir), { recursive: true });
            fs.symlinkSync(outsideDir, agentSkillDir);

            const syncSharedFiles = createSyncSharedFiles({
                root: tempDir,
                agentSkillDirs: [agentSkillDir],
                sharedFiles: new Map([[sharedSourcePath, Buffer.from('# Common\n')]]),
            });

            const result = syncSharedFiles.syncSharedFilesPhase({
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

            expect(result.sharedFailed).toBe(true);
            expect(result.errors).toEqual([{
                source: 'upstream',
                message: 'Shared file destination contains a symbolic link.',
                details: path.join(agentSkillDir, 'shared', 'common.md'),
            }]);
            expect(fs.readdirSync(outsideDir)).toEqual([]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('reports collected shared files that do not match the source skills root', () => {
        const tempDir = createTempDir();

        try {
            const requestedPath = '.agents/skills/shared/current.md';
            const collectedPath = 'other/skills/shared/current.md';
            const syncSharedFiles = createSyncSharedFiles({
                root: tempDir,
                agentSkillDirs: [path.join(tempDir, '.agents', 'skills')],
                sharedFileEntries: new Map([[requestedPath, {
                    path: collectedPath,
                    content: Buffer.from('# Current\n'),
                }]]),
            });

            const result = syncSharedFiles.syncSharedFilesPhase({
                manifest: createManifest(),
                lock: createLock(),
                discovered: {
                    upstream: createDiscoveredSource({
                        skillEntries: [createSkillEntry({
                            name: 'Alpha',
                            sourcePath: '.agents/skills/alpha',
                            sharedFiles: [requestedPath],
                        })],
                    }),
                },
            });

            expect(result).toMatchObject({
                sharedFailed: true,
                managedNewLocalPaths: { upstream: [] },
                sharedStats: { upstream: { declaredFiles: 1, copiedFiles: 0 } },
                sharedFileHashesBySource: {
                    upstream: [{
                        path: collectedPath,
                        sha256: Hashing.sha256Buffer(Buffer.from('# Current\n')),
                    }],
                },
                errors: [{
                    source: 'upstream',
                    message: 'Shared file path does not match source skills root.',
                    details: `.agents/skills: ${collectedPath}`,
                }],
            });
            expect(fs.existsSync(path.join(tempDir, '.agents', 'skills', 'shared', 'current.md'))).toBe(false);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('keeps stale managed files when another source takes ownership of the same path', () => {
        const tempDir = createTempDir();

        try {
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            const sharedSourcePath = '.agents/skills/shared/common.md';
            const localSharedPath = path.join(tempDir, sharedSourcePath);
            fs.mkdirSync(path.dirname(localSharedPath), { recursive: true });
            fs.writeFileSync(localSharedPath, '# Old\n', 'utf8');

            const newContent = Buffer.from('# New owner\n');
            const syncSharedFiles = createSyncSharedFiles({
                root: tempDir,
                agentSkillDirs: [agentSkillDir],
                sharedFiles: new Map([[sharedSourcePath, newContent]]),
                managedSharedFilesBySource: {
                    upstream: [sharedSourcePath],
                },
            });

            const result = syncSharedFiles.syncSharedFilesPhase({
                manifest: createManifest(),
                lock: createLock({
                    sources: {
                        upstream: createLockSourceMeta({
                            skillEntries: [createSkillEntry({
                                name: 'OldOwner',
                                sourcePath: '.agents/skills/old-owner',
                            })],
                        }),
                    },
                }),
                discovered: {
                    fork: createDiscoveredSource({
                        skillEntries: [createSkillEntry({
                            name: 'NewOwner',
                            sourcePath: '.agents/skills/new-owner',
                            sharedFiles: [sharedSourcePath],
                        })],
                    }),
                },
            });

            expect(result.sharedFailed).toBe(false);
            expect(result.removedFiles).toBe(0);
            expect(result.managedNewLocalPaths).toEqual({
                fork: [sharedSourcePath],
            });
            expect(fs.readFileSync(localSharedPath, 'utf8')).toBe('# New owner\n');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

function createSyncSharedFiles({
    root,
    agentSkillDirs,
    sharedFiles = new Map(),
    sharedFileEntries = new Map(),
    managedSharedFilesBySource = {},
}: FakeBackendOptions & { managedSharedFilesBySource?: { [key: string]: string[] } }): SyncSharedFiles {
    return new SyncSharedFiles({
        backend: createFakeBackend({ root, agentSkillDirs, sharedFiles, sharedFileEntries }),
        manifestStore: {
            lockManagedSharedFilesBySource(): { [key: string]: string[] } {
                return managedSharedFilesBySource;
            },
        },
    });
}

function createFakeBackend({ root, agentSkillDirs, sharedFiles = new Map(), sharedFileEntries = new Map() }: FakeBackendOptions): BackendLike {
    return {
        root,
        listSkills(): ReturnType<BackendLike['listSkills']> {
            return { ok: false, error: 'listSkills is not implemented in this test backend' };
        },
        resolveSource(): ReturnType<BackendLike['resolveSource']> {
            return { ok: false, error: 'resolveSource is not implemented in this test backend' };
        },
        collectSharedFiles(_source: string, sharedFilePaths: string[]): ReturnType<BackendLike['collectSharedFiles']> {
            const files: SharedFileContentEntry[] = [];
            for (const filePath of sharedFilePaths) {
                const entry = sharedFileEntries.get(filePath);
                if (entry) {
                    files.push(entry);
                    continue;
                }

                const content = sharedFiles.get(filePath);
                if (!content) {
                    return { ok: false, error: `Missing shared fixture: ${filePath}` };
                }
                files.push({ path: filePath, content });
            }

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
