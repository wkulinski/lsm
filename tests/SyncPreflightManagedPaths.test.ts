import path from 'node:path';

import { describe, expect, test } from 'vitest';

import SyncPreflightManagedPaths from '../src/core/sync/SyncPreflightManagedPaths';
import { createTempDir } from './helpers';
import type {
    BackendLike,
    DiscoveredSources,
    LockSourceMeta,
    SkillEntry,
} from '../src/core/types';

describe('SyncPreflightManagedPaths', () => {
    test('collects local skill directories and shared files managed by current discovery', () => {
        const tempDir = createTempDir();
        const agentSkillDir = path.join(tempDir, '.agents', 'skills');
        const managedPaths = new SyncPreflightManagedPaths({
            backend: createBackend(tempDir),
        });

        const result = managedPaths.collectNewManagedLocalPaths({
            discovered: {
                upstream: createDiscoveredSource({
                    skillEntries: [
                        createSkillEntry({
                            name: 'Alpha',
                            sourcePath: '.agents/skills/alpha',
                            sharedFiles: ['.agents/skills/shared/common.md'],
                        }),
                        createSkillEntry({
                            name: 'Beta',
                            sourcePath: '.agents/skills/group/beta',
                        }),
                    ],
                }),
            },
            currentAgentSkillDirs: [agentSkillDir],
        });

        expect([...result.skillDirs]).toEqual([
            '.agents/skills/alpha',
            '.agents/skills/group/beta',
        ]);
        expect([...result.sharedFiles]).toEqual([
            '.agents/skills/shared/common.md',
        ]);
    });
});

function createBackend(root: string): BackendLike {
    return { root } as BackendLike;
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
