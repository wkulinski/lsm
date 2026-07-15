import { describe, expect, test } from 'vitest';

import SyncDiscovery from '../src/core/sync/SyncDiscovery';
import type {
    BackendLike,
    FileHashEntry,
    ManifestData,
    ResolvedSourceMeta,
    SkillEntry,
} from '../src/core/types';

interface ListSkillsCall {
    source: string;
    options: { includeInternal?: boolean; fullDepth?: boolean };
}

describe('SyncDiscovery', () => {
    test('discovers all skills from a source without internal entries', () => {
        const calls: ListSkillsCall[] = [];
        const discovery = new SyncDiscovery({
            backend: createBackend({
                calls,
                results: {
                    upstream: createListedSkillsResult({
                        skillEntries: [
                            createSkillEntry({ name: 'Alpha', sourcePath: '.agents/skills/alpha' }),
                            createSkillEntry({ name: 'Beta', sourcePath: '.agents/skills/beta' }),
                        ],
                        sharedFileHashes: [{ path: '.agents/skills/shared/common.md', sha256: 'abc123' }],
                    }),
                },
            }),
        });

        const result = discovery.discover(createManifest({
            sources: [{ source: 'upstream', skills: null, publish: { branchPrefix: null, createPr: null } }],
        }));

        expect(calls).toEqual([{ source: 'upstream', options: { includeInternal: false } }]);
        expect(result.missingRequested).toEqual([]);
        expect(result.discovered.upstream).toMatchObject({
            mode: 'all',
            skills: ['Alpha', 'Beta'],
            skillEntries: [
                { name: 'Alpha', sourcePath: '.agents/skills/alpha' },
                { name: 'Beta', sourcePath: '.agents/skills/beta' },
            ],
            sharedFileHashes: [{ path: '.agents/skills/shared/common.md', sha256: 'abc123' }],
            missingRequested: [],
            resolved: createResolvedMeta(),
        });
        expect(result.discovered.upstream.listedAt).toEqual(expect.any(String));
    });

    test('resolves explicit skills through aliases and filters shared file hashes', () => {
        const calls: ListSkillsCall[] = [];
        const discovery = new SyncDiscovery({
            backend: createBackend({
                calls,
                results: {
                    upstream: createListedSkillsResult({
                        skillEntries: [
                            createSkillEntry({
                                name: 'Alpha',
                                sourcePath: '.agents/skills/alpha',
                                sharedFiles: ['.agents/skills/shared/alpha.md'],
                            }),
                            createSkillEntry({
                                name: 'Beta',
                                sourcePath: '.agents/skills/beta',
                                sharedFiles: ['.agents/skills/shared/beta.md'],
                            }),
                        ],
                        aliasMap: new Map([
                            ['alpha-alias', 'Alpha'],
                            ['alpha', 'Alpha'],
                            ['beta', 'Beta'],
                        ]),
                        sharedFileHashes: [
                            { path: '.agents/skills/shared/alpha.md', sha256: 'alpha-hash' },
                            { path: '.agents/skills/shared/beta.md', sha256: 'beta-hash' },
                        ],
                    }),
                },
            }),
        });

        const result = discovery.discover(createManifest({
            sources: [{ source: 'upstream', skills: ['alpha-alias', 'Missing'], publish: { branchPrefix: null, createPr: null } }],
        }));

        expect(calls).toEqual([{ source: 'upstream', options: { includeInternal: true } }]);
        expect(result.missingRequested).toEqual([{ source: 'upstream', skill: 'Missing' }]);
        expect(result.discovered.upstream).toMatchObject({
            mode: 'explicit',
            skills: ['Alpha'],
            skillEntries: [{
                name: 'Alpha',
                sourcePath: '.agents/skills/alpha',
                sharedFiles: ['.agents/skills/shared/alpha.md'],
            }],
            sharedFileHashes: [{ path: '.agents/skills/shared/alpha.md', sha256: 'alpha-hash' }],
            missingRequested: ['Missing'],
            resolved: createResolvedMeta(),
        });
    });

    test('throws backend list errors with details', () => {
        const discovery = new SyncDiscovery({
            backend: createBackend({
                results: {
                    upstream: {
                        ok: false,
                        error: 'Cannot list skills.',
                        details: 'backend failed while cloning',
                    },
                },
            }),
        });

        expect(() => discovery.discover(createManifest({
            sources: [{ source: 'upstream', skills: null, publish: { branchPrefix: null, createPr: null } }],
        }))).toThrow('Cannot list skills.');
    });
});

function createBackend(
    {
        calls = [],
        results,
    }: {
        calls?: ListSkillsCall[];
        results: { [source: string]: ReturnType<BackendLike['listSkills']> };
    },
): BackendLike {
    return {
        root: '/tmp/project',
        listSkills(source: string, options: { includeInternal?: boolean; fullDepth?: boolean } = {}): ReturnType<BackendLike['listSkills']> {
            calls.push({ source, options });
            return results[source] ?? { ok: false, error: `Missing fixture for source: ${source}` };
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
        installSkillEntries(): ReturnType<BackendLike['installSkillEntries']> {
            return { ok: true, status: 0, cmd: ['fake-install'] };
        },
        removeSkillEntries(): ReturnType<BackendLike['removeSkillEntries']> {
            return { ok: true, status: 0, cmd: ['fake-remove'] };
        },
    };
}

function createListedSkillsResult(
    {
        skillEntries,
        sharedFileHashes = [],
        aliasMap,
    }: {
        skillEntries: SkillEntry[];
        sharedFileHashes?: FileHashEntry[];
        aliasMap?: Map<string, string>;
    },
): ReturnType<BackendLike['listSkills']> {
    const effectiveAliasMap = aliasMap ?? new Map(skillEntries.map(entry => [entry.name.toLowerCase(), entry.name]));

    return {
        ok: true,
        skills: skillEntries.map(entry => entry.name),
        skillEntries,
        sharedFileHashes,
        aliasMap: effectiveAliasMap,
        resolved: createResolvedMeta(),
    };
}

function createManifest({ sources }: { sources: ManifestData['sources'] }): ManifestData {
    return {
        agents: ['codex'],
        sources,
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
