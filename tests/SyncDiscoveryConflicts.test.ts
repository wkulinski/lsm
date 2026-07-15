import { describe, expect, test } from 'vitest';

import SyncDiscoveryConflicts from '../src/core/sync/SyncDiscoveryConflicts';
import type {
    DiscoveredSources,
    SkillEntry,
} from '../src/core/types';

describe('SyncDiscoveryConflicts', () => {
    test('allows unique skill names across sources', () => {
        const conflicts = new SyncDiscoveryConflicts();

        expect(() => {
            conflicts.assertNoConflicts({
                upstream: createDiscoveredSource({
                    skillEntries: [createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' })],
                }),
                fork: createDiscoveredSource({
                    skillEntries: [createSkillEntry({ name: 'Beta', sourcePath: '.agents/skills/beta' })],
                }),
            });
        }).not.toThrow();
    });

    test('throws when a skill name is discovered from multiple sources', () => {
        const conflicts = new SyncDiscoveryConflicts();

        expect(() => {
            conflicts.assertNoConflicts({
                upstream: createDiscoveredSource({
                    skillEntries: [createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' })],
                }),
                fork: createDiscoveredSource({
                    skillEntries: [createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/fork-alpha' })],
                }),
            });
        }).toThrow('Skill name conflicts detected.');
    });

    test('throws when skill names differ only by case', () => {
        const conflicts = new SyncDiscoveryConflicts();

        expect(() => {
            conflicts.assertNoConflicts({
                upstream: createDiscoveredSource({
                    skillEntries: [createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' })],
                }),
                fork: createDiscoveredSource({
                    skillEntries: [createSkillEntry({ name: 'alpha', sourcePath: '.agents/skills/fork-alpha' })],
                }),
            });
        }).toThrow('Skill name conflicts detected.');
    });
});

function createDiscoveredSource({ skillEntries }: { skillEntries: SkillEntry[] }): DiscoveredSources[string] {
    return {
        mode: 'all',
        listedAt: '2026-06-05T00:00:00.000Z',
        skills: skillEntries.map(entry => entry.name),
        skillEntries,
        sharedFileHashes: [],
        missingRequested: [],
        resolved: {
            requestedRef: null,
            defaultBranch: 'main',
            resolvedRef: 'main',
            resolvedCommit: 'abc123',
            subpath: null,
            resolvedAt: '2026-06-05T00:00:00.000Z',
        },
    };
}

function createSkillEntry({ name, sourcePath }: { name: string; sourcePath: string }): SkillEntry {
    return {
        name,
        sourcePath,
        sharedFiles: [],
        hash: null,
    };
}
