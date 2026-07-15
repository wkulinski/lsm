import { describe, expect, test } from 'vitest';

import PublishPathMapper from '../src/core/publish/PublishPathMapper';
import type {
    LockSourceMeta,
    SkillEntry,
} from '../src/core/types';

describe('PublishPathMapper', () => {
    test('normalizes managed entries and shared files', () => {
        const mapper = new PublishPathMapper();
        const lockSource = createLockSource({
            skillEntries: [
                createSkillEntry({
                    name: 'Alpha',
                    sourcePath: '.agents\\skills\\alpha',
                    sharedFiles: ['.agents\\skills\\shared\\b.md', '.agents/skills/shared/a.md', '.agents/skills/shared/a.md'],
                }),
            ],
        });

        expect(mapper.resolveManagedEntries(lockSource)).toEqual([{
            name: 'Alpha',
            sourcePath: '.agents/skills/alpha',
            sharedFiles: ['.agents/skills/shared/a.md', '.agents/skills/shared/b.md'],
            hash: null,
        }]);
    });

    test('resolves one skills root and rejects ambiguous roots', () => {
        const mapper = new PublishPathMapper();

        expect(mapper.resolveSourceSkillsRootPrefix([
            { sourcePath: '.agents/skills/alpha' },
            { sourcePath: '.agents/skills/beta' },
        ])).toEqual({ ok: true, prefix: '.agents/skills' });
        expect(mapper.resolveSourceSkillsRootPrefix([
            { sourcePath: '.agents/skills/alpha' },
            { sourcePath: 'other/skills/beta' },
        ])).toEqual({
            ok: false,
            error: 'Multiple skills roots detected: .agents/skills, other/skills',
        });
        expect(mapper.resolveSourceSkillsRootPrefix([])).toEqual({
            ok: false,
            error: 'No skills root could be inferred.',
        });
    });

    test('maps shared file owners from source roots to local skills root', () => {
        const mapper = new PublishPathMapper();

        expect([...mapper.resolveSharedFileOwners({
            upstream: createLockSource({
                skillEntries: [
                    createSkillEntry({
                        name: 'Alpha',
                        sourcePath: '.agents/skills/alpha',
                        sharedFiles: ['.agents/skills/shared/common.md'],
                    }),
                ],
            }),
            fork: createLockSource({
                skillEntries: [
                    createSkillEntry({
                        name: 'Beta',
                        sourcePath: 'vendor/skills/beta',
                        sharedFiles: ['vendor/skills/shared/fork.md'],
                    }),
                ],
            }),
        }, '.agents/skills').entries()]).toEqual([
            ['.agents/skills/shared/common.md', 'upstream'],
            ['.agents/skills/shared/fork.md', 'fork'],
        ]);
    });

    test('deduplicates managed skill owners and collected shared files', () => {
        const mapper = new PublishPathMapper();
        const alpha = createSkillEntry({
            name: 'Alpha',
            sourcePath: '.agents/skills/alpha',
            sharedFiles: ['.agents/skills/shared/b.md', '.agents\\skills\\shared\\a.md'],
        });

        expect([...mapper.resolveManagedSkillOwners({
            upstream: createLockSource({ skillEntries: [alpha] }),
            fork: createLockSource({
                skillEntries: [
                    createSkillEntry({ name: 'alpha', sourcePath: 'fork/skills/alpha' }),
                    createSkillEntry({ name: 'Beta', sourcePath: 'fork/skills/beta' }),
                ],
            }),
        }).entries()]).toEqual([
            ['alpha', 'upstream'],
            ['beta', 'fork'],
        ]);
        expect(mapper.collectSharedFilesFromSkillEntries([
            alpha,
            createSkillEntry({
                name: 'Beta',
                sourcePath: '.agents/skills/beta',
                sharedFiles: ['.agents/skills/shared/b.md'],
            }),
        ])).toEqual([
            '.agents/skills/shared/a.md',
            '.agents/skills/shared/b.md',
        ]);
    });
});

function createLockSource({ skillEntries }: { skillEntries: SkillEntry[] }): LockSourceMeta {
    return {
        mode: 'all',
        listedAt: '2026-06-05T00:00:00.000Z',
        skillEntries,
        sharedFileHashes: [],
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

function createSkillEntry(
    {
        name,
        sourcePath,
        sharedFiles = [],
    }: {
        name: string;
        sourcePath: string;
        sharedFiles?: string[];
    },
): SkillEntry {
    return {
        name,
        sourcePath,
        sharedFiles,
        hash: null,
    };
}
