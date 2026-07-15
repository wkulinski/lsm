import { describe, expect, test } from 'vitest';

import {
    lockManagedSharedFilesBySource,
    lockManagedSkills,
    lockSourcesFromDiscovered,
} from '../src/core/manifest/lockMappers';
import type {
    DiscoveredSources,
    ResolvedSourceMeta,
    SkillEntry,
} from '../src/core/types';

describe('lockSourcesFromDiscovered', () => {
    test('maps discovered source metadata and shared hashes into lock sources', () => {
        const alpha = createSkillEntry({
            name: 'Alpha',
            sourcePath: '.agents/skills/alpha',
            sharedFiles: ['.agents/skills/shared/alpha.md'],
            hash: {
                treeSha256: 'alpha-tree',
                files: [{ path: 'SKILL.md', sha256: 'skill-hash' }],
            },
        });
        const beta = createSkillEntry({
            name: 'Beta',
            sourcePath: '.agents/skills/beta',
        });
        const resolved = createResolvedMeta();

        expect(lockSourcesFromDiscovered({
            upstream: createDiscoveredSource({
                mode: 'explicit',
                listedAt: '2026-06-05T00:00:00.000Z',
                skillEntries: [alpha],
                resolved,
            }),
            fork: createDiscoveredSource({
                mode: 'all',
                listedAt: '2026-06-06T00:00:00.000Z',
                skillEntries: [beta],
                resolved,
            }),
        }, {
            upstream: [{ path: '.agents/skills/shared/alpha.md', sha256: 'shared-hash' }],
        })).toEqual({
            upstream: {
                mode: 'explicit',
                listedAt: '2026-06-05T00:00:00.000Z',
                skillEntries: [{
                    name: 'Alpha',
                    sourcePath: '.agents/skills/alpha',
                    sharedFiles: ['.agents/skills/shared/alpha.md'],
                    hash: {
                        treeSha256: 'alpha-tree',
                        files: [{ path: 'SKILL.md', sha256: 'skill-hash' }],
                    },
                }],
                sharedFileHashes: [{ path: '.agents/skills/shared/alpha.md', sha256: 'shared-hash' }],
                resolved,
            },
            fork: {
                mode: 'all',
                listedAt: '2026-06-06T00:00:00.000Z',
                skillEntries: [{
                    name: 'Beta',
                    sourcePath: '.agents/skills/beta',
                    sharedFiles: [],
                    hash: null,
                }],
                sharedFileHashes: [],
                resolved,
            },
        });
    });

    test('maps managed skills and shared files from lock sources', () => {
        expect(lockManagedSkills({
            upstream: createLockSource({
                skillEntries: [
                    createSkillEntry({ name: ' Beta ', sourcePath: '.agents/skills/beta' }),
                    createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' }),
                ],
                sharedFileHashes: [],
            }),
            fork: createLockSource({
                skillEntries: [
                    createSkillEntry({ name: 'alpha', sourcePath: '.agents/skills/alpha-fork' }),
                    createSkillEntry({ name: 'Gamma', sourcePath: '.agents/skills/gamma' }),
                ],
                sharedFileHashes: [],
            }),
        })).toEqual(['alpha', 'Alpha', 'Beta', 'Gamma']);

        expect(lockManagedSharedFilesBySource({
            upstream: createLockSource({
                skillEntries: [
                    createSkillEntry({
                        name: 'Alpha',
                        sourcePath: '.agents/skills/alpha',
                        sharedFiles: ['.agents/skills/shared/b.md', '.agents/skills/shared/a.md'],
                    }),
                ],
                sharedFileHashes: [
                    { path: '.agents/skills/shared/hash-only.md', sha256: 'hash' },
                ],
            }),
        })).toEqual({
            upstream: [
                '.agents/skills/shared/a.md',
                '.agents/skills/shared/b.md',
                '.agents/skills/shared/hash-only.md',
            ],
        });
    });
});

function createLockSource(
    {
        skillEntries,
        sharedFileHashes,
    }: {
        skillEntries: SkillEntry[];
        sharedFileHashes: { path: string; sha256: string }[];
    },
): DiscoveredSources[string] {
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

function createDiscoveredSource(
    {
        mode,
        listedAt,
        skillEntries,
        resolved,
    }: {
        mode: DiscoveredSources[string]['mode'];
        listedAt: string;
        skillEntries: SkillEntry[];
        resolved: ResolvedSourceMeta;
    },
): DiscoveredSources[string] {
    return {
        mode,
        listedAt,
        skills: skillEntries.map(entry => entry.name),
        skillEntries,
        sharedFileHashes: [],
        missingRequested: [],
        resolved,
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

function createResolvedMeta(): ResolvedSourceMeta {
    return {
        requestedRef: null,
        defaultBranch: 'main',
        resolvedRef: 'main',
        resolvedCommit: 'abc123',
        subpath: null,
        resolvedAt: '2026-06-05T00:00:00.000Z',
    };
}
