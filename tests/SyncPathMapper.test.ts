import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import SyncPathMapper from '../src/core/sync/SyncPathMapper';
import { createTempDir } from './helpers';
import type {
    BackendLike,
    LockSourceMeta,
    SkillEntry,
} from '../src/core/types';

describe('SyncPathMapper', () => {
    test('collects declared shared files in stable unique order', () => {
        const mapper = new SyncPathMapper({ backend: createBackend('/tmp/project') });

        expect(mapper.collectSharedFilesFromSkillEntries([
            createSkillEntry({
                name: 'Beta',
                sourcePath: '.agents/skills/beta',
                sharedFiles: ['.agents/skills/shared/z.md', ' '],
            }),
            createSkillEntry({
                name: 'Alpha',
                sourcePath: '.agents/skills/alpha',
                sharedFiles: ['.agents/skills/shared/a.md', '.agents/skills/shared/z.md'],
            }),
        ])).toEqual([
            '.agents/skills/shared/a.md',
            '.agents/skills/shared/z.md',
        ]);
    });

    test('maps source shared files to project-relative local paths', () => {
        const tempDir = createTempDir();

        try {
            const mapper = new SyncPathMapper({ backend: createBackend(tempDir) });
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');

            expect(mapper.mapSourceSharedFilesToLocalPaths({
                sourcePaths: ['.agents/skills/shared/current.md'],
                sourceMeta: createLockSourceMeta({
                    skillEntries: [createSkillEntry({
                        name: 'Example',
                        sourcePath: '.agents/skills/example',
                    })],
                }),
                agentSkillDirs: [agentSkillDir],
            })).toEqual(['.agents/skills/shared/current.md']);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects ambiguous source skills roots', () => {
        const mapper = new SyncPathMapper({ backend: createBackend('/tmp/project') });

        expect(mapper.resolveSourceSkillsRootPrefix([
            { sourcePath: 'repo-a/skills/alpha' },
            { sourcePath: 'repo-b/skills/beta' },
        ])).toEqual({
            ok: false,
            error: 'Multiple skills roots detected: repo-a/skills, repo-b/skills',
        });
    });
});

function createBackend(root: string): BackendLike {
    return { root } as BackendLike;
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

function createLockSourceMeta({ skillEntries = [] }: Partial<LockSourceMeta> = {}): LockSourceMeta {
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
