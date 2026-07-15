import { describe, expect, test } from 'vitest';

import SyncPlanner from '../src/core/sync/SyncPlanner';
import type {
    DiscoveredSources,
    LockData,
    LockSourceMeta,
    ManifestData,
    SkillEntry,
} from '../src/core/types';

describe('SyncPlanner', () => {
    test('plans removed agents and skills missing from current discovery', () => {
        const planner = new SyncPlanner({
            manifestStore: createManifestStore({
                managedSkills: ['Alpha', 'Beta'],
            }),
        });

        expect(planner.planRemovals({
            lock: createLock({
                agents: ['codex', 'cursor'],
                sources: {
                    upstream: createLockSourceMeta({
                        skillEntries: [
                            createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' }),
                            createSkillEntry({ name: 'Beta', sourcePath: '.agents/skills/beta' }),
                        ],
                    }),
                },
            }),
            manifest: createManifest({ agents: ['codex'] }),
            discovered: {
                upstream: createDiscoveredSource({
                    skillEntries: [createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' })],
                }),
            },
        })).toMatchObject({
            oldAgents: ['codex', 'cursor'],
            newAgents: ['codex'],
            agentsUnion: ['codex', 'cursor'],
            agentsRemoved: ['cursor'],
            oldManaged: ['Alpha', 'Beta'],
            newManaged: ['Alpha'],
            skillsRemoved: ['Beta'],
            skillsRemovedEntries: [{ name: 'Beta', sourcePath: '.agents/skills/beta' }],
        });
    });

    test('matches removed skill entries case-insensitively across lock sources', () => {
        const planner = new SyncPlanner({
            manifestStore: createManifestStore({
                managedSkills: ['BETA'],
            }),
        });

        expect(planner.planRemovals({
            lock: createLock({
                sources: {
                    upstream: createLockSourceMeta({
                        skillEntries: [
                            createSkillEntry({ name: 'beta', sourcePath: '.agents/skills/beta' }),
                        ],
                    }),
                    fork: createLockSourceMeta({
                        skillEntries: [
                            createSkillEntry({ name: 'BETA', sourcePath: '.agents/skills/fork-beta' }),
                        ],
                    }),
                },
            }),
            manifest: createManifest(),
            discovered: {
                upstream: createDiscoveredSource({ skillEntries: [] }),
            },
        })).toMatchObject({
            skillsRemoved: ['BETA'],
            skillsRemovedEntries: [
                { name: 'beta', sourcePath: '.agents/skills/beta' },
                { name: 'BETA', sourcePath: '.agents/skills/fork-beta' },
            ],
        });
    });

    test('deduplicates managed entries and sorts current managed skills from discovery', () => {
        const planner = new SyncPlanner({
            manifestStore: createManifestStore({
                managedSkills: ['Alpha', 'Beta'],
            }),
        });

        expect(planner.planRemovals({
            lock: createLock({
                sources: {
                    upstream: createLockSourceMeta({
                        skillEntries: [
                            createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' }),
                            createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' }),
                            createSkillEntry({ name: 'Beta', sourcePath: '.agents/skills/beta' }),
                        ],
                    }),
                },
            }),
            manifest: createManifest(),
            discovered: {
                second: createDiscoveredSource({
                    skillEntries: [createSkillEntry({ name: 'Gamma', sourcePath: '.agents/skills/gamma' })],
                }),
                first: createDiscoveredSource({
                    skillEntries: [createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' })],
                }),
            },
        })).toMatchObject({
            oldManagedEntries: [
                { name: 'Alpha', sourcePath: '.agents/skills/alpha' },
                { name: 'Beta', sourcePath: '.agents/skills/beta' },
            ],
            newManaged: ['Alpha', 'Gamma'],
            skillsRemoved: ['Beta'],
        });
    });
});

function createManifestStore({ managedSkills = [] }: { managedSkills?: string[] }): ConstructorParameters<typeof SyncPlanner>[0]['manifestStore'] {
    return {
        lockManagedSkills(): string[] {
            return managedSkills;
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
