import { describe, expect, test } from 'vitest';

import SyncInstallPhase from '../src/core/sync/SyncInstallPhase';
import type {
    BackendLike,
    DiscoveredSources,
    SkillEntry,
} from '../src/core/types';

interface FakeBackend extends BackendLike {
    installed: Parameters<BackendLike['installSkillEntries']>[0][];
}

describe('SyncInstallPhase', () => {
    test('skips sources without desired skills', () => {
        const backend = createBackend();
        const installer = new SyncInstallPhase({ backend });

        expect(installer.addPhase({
            empty: createDiscoveredSource({ skillEntries: [] }),
        }, ['codex'])).toEqual({
            installs: [{ source: 'empty', ok: true, skipped: true }],
            addFailed: false,
        });
        expect(backend.installed).toEqual([]);
    });

    test('installs discovered skill entries for each source', () => {
        const backend = createBackend();
        const installer = new SyncInstallPhase({ backend });
        const alpha = createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' });
        const beta = createSkillEntry({ name: 'Beta', sourcePath: '.agents/skills/beta' });

        expect(installer.addPhase({
            upstream: createDiscoveredSource({ skillEntries: [alpha] }),
            fork: createDiscoveredSource({ skillEntries: [beta] }),
        }, ['codex', 'cursor'])).toEqual({
            installs: [
                { source: 'upstream', ok: true, status: 0, cmd: ['fake-install'] },
                { source: 'fork', ok: true, status: 0, cmd: ['fake-install'] },
            ],
            addFailed: false,
        });
        expect(backend.installed).toEqual([
            { source: 'upstream', skillEntries: [alpha], agents: ['codex', 'cursor'] },
            { source: 'fork', skillEntries: [beta], agents: ['codex', 'cursor'] },
        ]);
    });

    test('marks add as failed when backend install fails', () => {
        const backend = createBackend({
            installResults: [{
                ok: false,
                status: 1,
                cmd: ['fake-install'],
                error: 'install failed',
                details: 'backend details',
            }],
        });
        const installer = new SyncInstallPhase({ backend });

        expect(installer.addPhase({
            upstream: createDiscoveredSource({
                skillEntries: [createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' })],
            }),
        }, ['codex'])).toEqual({
            installs: [{
                source: 'upstream',
                ok: false,
                status: 1,
                cmd: ['fake-install'],
                error: 'install failed',
                details: 'backend details',
            }],
            addFailed: true,
        });
    });
});

function createBackend({ installResults = [] }: { installResults?: ReturnType<BackendLike['installSkillEntries']>[] } = {}): FakeBackend {
    const installed: FakeBackend['installed'] = [];
    const queuedInstallResults = [...installResults];

    return {
        root: '/tmp/project',
        installed,
        listSkills(): ReturnType<BackendLike['listSkills']> {
            return { ok: false, error: 'listSkills is not implemented in this test backend' };
        },
        resolveSource(): ReturnType<BackendLike['resolveSource']> {
            return { ok: false, error: 'resolveSource is not implemented in this test backend' };
        },
        collectSharedFiles(): ReturnType<BackendLike['collectSharedFiles']> {
            return { ok: false, error: 'collectSharedFiles is not implemented in this test backend' };
        },
        resolveAgentProjectSkillDirs(): ReturnType<BackendLike['resolveAgentProjectSkillDirs']> {
            return { ok: true, dirs: [] };
        },
        installSkillEntries(input: Parameters<BackendLike['installSkillEntries']>[0]): ReturnType<BackendLike['installSkillEntries']> {
            installed.push(input);
            return queuedInstallResults.shift() ?? { ok: true, status: 0, cmd: ['fake-install'] };
        },
        removeSkillEntries(): ReturnType<BackendLike['removeSkillEntries']> {
            return { ok: true, status: 0, cmd: ['fake-remove'] };
        },
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
