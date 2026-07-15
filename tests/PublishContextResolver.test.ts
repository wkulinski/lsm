import path from 'node:path';

import { describe, expect, test } from 'vitest';

import PublishContextResolver from '../src/core/publish/PublishContextResolver';
import { createTempDir } from './helpers';
import type {
    BackendLike,
    LocalSkill,
    LockData,
    LockSourceMeta,
    ManifestData,
    ResolvedSource,
    SkillEntry,
} from '../src/core/types';

describe('PublishContextResolver', () => {
    test('prepares publish context with resolved lock source, plan, and source info', () => {
        const tempDir = createTempDir();
        const lockSource = createLockSource({
            skillEntries: [
                createSkillEntry({
                    name: 'Alpha',
                    sourcePath: '.agents/skills/alpha',
                }),
            ],
        });
        const lock = createLock({ sources: { upstream: lockSource } });
        const resolver = createResolver({
            root: tempDir,
            lock,
            localSkills: [
                createLocalSkill(tempDir, {
                    name: 'Alpha',
                    sourcePath: '.agents/skills/alpha',
                }),
            ],
        });

        expect(resolver.prepare({
            manifest: createManifest(),
            lock,
            targetSource: { ok: true, source: 'upstream', sourceEntry: createManifest().sources[0] },
            selectedNewSkills: [],
            selectedRemoveSkills: [],
            effectiveCreatePr: true,
            dryRun: false,
            confirmDeletes: false,
        })).toMatchObject({
            ok: true,
            context: {
                targetSource: 'upstream',
                lockSource,
                resolvedCommit: 'abc123',
                sourceInfo: createSourceInfo(),
                plan: {
                    items: [{
                        type: 'directory',
                        localPath: path.join(tempDir, '.agents', 'skills', 'alpha'),
                        targetPath: '.agents/skills/alpha',
                    }],
                    errors: [],
                    warnings: [],
                },
            },
        });
    });

    test('returns noop result when managed skills are missing without explicit removal', () => {
        const tempDir = createTempDir();
        const lockSource = createLockSource({
            skillEntries: [
                createSkillEntry({
                    name: 'Alpha',
                    sourcePath: '.agents/skills/alpha',
                }),
            ],
        });
        const lock = createLock({ sources: { upstream: lockSource } });
        const resolver = createResolver({
            root: tempDir,
            lock,
            localSkills: [
                createLocalSkill(tempDir, {
                    name: 'Beta',
                    sourcePath: '.agents/skills/beta',
                }),
            ],
        });

        expect(resolver.prepare({
            manifest: createManifest(),
            lock,
            targetSource: { ok: true, source: 'upstream', sourceEntry: createManifest().sources[0] },
            selectedNewSkills: [],
            selectedRemoveSkills: [],
            effectiveCreatePr: false,
            dryRun: true,
            confirmDeletes: false,
        })).toEqual({
            ok: true,
            result: {
                ok: true,
                source: 'upstream',
                branch: null,
                dryRun: true,
                changedFiles: [],
                warnings: [
                    'Skill "Alpha" is managed but missing locally; skipping upstream deletion. '
                    + 'Use --remove-skill "Alpha" and --confirm-deletes to remove it upstream.',
                ],
                newSkills: [],
                removeSkills: [],
                createPr: false,
                message: 'No publishable changes found.',
            },
        });
    });

    test('blocks planned deletes without confirmDeletes', () => {
        const tempDir = createTempDir();
        const lockSource = createLockSource({
            skillEntries: [
                createSkillEntry({
                    name: 'Alpha',
                    sourcePath: '.agents/skills/alpha',
                }),
            ],
        });
        const lock = createLock({ sources: { upstream: lockSource } });
        const resolver = createResolver({
            root: tempDir,
            lock,
            localSkills: [
                createLocalSkill(tempDir, {
                    name: 'Beta',
                    sourcePath: '.agents/skills/beta',
                }),
            ],
        });

        expect(resolver.prepare({
            manifest: createManifest(),
            lock,
            targetSource: { ok: true, source: 'upstream', sourceEntry: createManifest().sources[0] },
            selectedNewSkills: [],
            selectedRemoveSkills: ['Alpha'],
            effectiveCreatePr: true,
            dryRun: false,
            confirmDeletes: false,
        })).toEqual({
            ok: false,
            error: 'Delete operations were planned but --confirm-deletes was not provided.',
            details: [
                'Planned delete paths:',
                '  - [directory] .agents/skills/alpha',
                '',
                'Re-run with --confirm-deletes to allow these deletions.',
            ].join('\n'),
        });
    });

    test('reports missing lock source and missing resolved commit', () => {
        const tempDir = createTempDir();
        const lockSource = createLockSource({ resolvedCommit: null });
        const lock = createLock({ sources: { upstream: lockSource } });
        const resolver = createResolver({
            root: tempDir,
            lock,
            localSkills: [],
        });

        expect(resolver.readLockSource(lock, 'missing')).toEqual({
            ok: false,
            error: 'Source "missing" is missing in skills.lock.json. Run sync first.',
        });
        expect(resolver.readLockSource(lock, 'upstream')).toEqual({
            ok: false,
            error: 'Missing resolved commit for "upstream" in lock. Run sync first.',
        });
    });
});

function createResolver({
    root,
    lock,
    localSkills,
}: {
    root: string;
    lock: LockData;
    localSkills: LocalSkill[];
}): PublishContextResolver {
    return new PublishContextResolver({
        backend: createBackend(root),
        manifestStore: {
            lockManagedSkills(): string[] {
                return Object.values(lock.sources)
                    .flatMap(source => source.skillEntries)
                    .map(entry => entry.name);
            },
        },
        localSkillDiscoverer(): Map<string, LocalSkill> {
            return new Map(localSkills.map(skill => [skill.name.toLowerCase(), skill]));
        },
    });
}

function createBackend(root: string): BackendLike {
    return {
        root,
        listSkills(): ReturnType<BackendLike['listSkills']> {
            return { ok: false, error: 'listSkills is not implemented in this test backend' };
        },
        resolveSource(): ReturnType<BackendLike['resolveSource']> {
            return createSourceInfo();
        },
        collectSharedFiles(): ReturnType<BackendLike['collectSharedFiles']> {
            return { ok: false, error: 'collectSharedFiles is not implemented in this test backend' };
        },
        resolveAgentProjectSkillDirs(): ReturnType<BackendLike['resolveAgentProjectSkillDirs']> {
            return { ok: true, dirs: [path.join(root, '.agents', 'skills')] };
        },
        installSkillEntries(): ReturnType<BackendLike['installSkillEntries']> {
            return { ok: true, status: 0, cmd: ['fake-install'] };
        },
        removeSkillEntries(): ReturnType<BackendLike['removeSkillEntries']> {
            return { ok: true, status: 0, cmd: ['fake-remove'] };
        },
    };
}

function createManifest(): ManifestData {
    return {
        agents: ['codex'],
        sources: [{ source: 'upstream', skills: null, publish: { branchPrefix: null, createPr: null } }],
    };
}

function createLock({ sources }: { sources: LockData['sources'] }): LockData {
    return {
        schemaVersion: 5,
        agents: ['codex'],
        sources,
    };
}

function createLockSource(
    {
        skillEntries = [],
        resolvedCommit = 'abc123',
    }: {
        skillEntries?: SkillEntry[];
        resolvedCommit?: string | null;
    } = {},
): LockSourceMeta {
    return {
        mode: 'all',
        listedAt: '2026-06-05T00:00:00.000Z',
        skillEntries,
        sharedFileHashes: [],
        resolved: {
            requestedRef: null,
            defaultBranch: 'main',
            resolvedRef: 'main',
            resolvedCommit,
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

function createLocalSkill(root: string, { name, sourcePath }: { name: string; sourcePath: string }): LocalSkill {
    return {
        name,
        path: path.join(root, sourcePath),
        dirName: path.basename(sourcePath),
        sourcePath,
        sharedFiles: [],
    };
}

function createSourceInfo(): ResolvedSource {
    return {
        ok: true,
        handler: 'github',
        provider: 'github',
        url: 'https://github.com/owner/repo.git',
        ref: null,
        subpath: null,
        webUrl: 'https://github.com/owner/repo',
    };
}
