import { describe, expect, test } from 'vitest';

import type { PreparePublishContextNoop } from '../src/core/publish/PublishContextResolver';
import PublishService from '../src/core/publish/PublishService';
import PublishResultBuilder from '../src/core/publish/PublishResultBuilder';
import type { PublishErrorResult, ResolvePublishParametersSuccess } from '../src/core/publish/PublishParameterResolver';
import type { StagePublishPlanResult } from '../src/core/publish/PublishWorkspace';
import type {
    BackendLike,
    LockData,
    LockSourceMeta,
    ManifestData,
    ManifestSourceEntry,
    ResolvedSource,
} from '../src/core/types';

describe('PublishService', () => {
    test('returns prepared noop result without touching workspace', () => {
        const noopResult = new PublishResultBuilder().buildBase({
            source: 'upstream',
            dryRun: true,
            changedFiles: [],
            warnings: ['nothing to publish'],
            newSkills: [],
            removeSkills: [],
            createPr: false,
            message: 'No publishable changes found.',
        });
        const workspaceCalls: string[] = [];
        const service = new PublishService({
            backend: createBackend(),
            manifestStore: createManifestStore(),
            parameterResolver: {
                resolve: (): ResolvePublishParametersSuccess => ({
                    ok: true,
                    targetSource: { ok: true, source: 'upstream', sourceEntry: createSourceEntry() },
                    publishConfig: { branchPrefix: null, createPr: null },
                    selectedNewSkills: [],
                    selectedRemoveSkills: [],
                    effectiveCreatePr: false,
                }),
            },
            contextResolver: {
                prepare: (): PreparePublishContextNoop => ({
                    ok: true,
                    result: noopResult,
                }),
            },
            workspace: createWorkspace({
                calls: workspaceCalls,
                stageResult: { ok: true, result: { message: 'unused' } },
            }),
        });

        expect(service.publish({
            manifest: createManifest(),
            lock: createLock(),
            dryRun: true,
        })).toBe(noopResult);
        expect(workspaceCalls).toEqual([]);
    });

    test('executes dry-run after staging without commit and cleans up clone', () => {
        const calls: string[] = [];
        const service = new PublishService({
            backend: createBackend(),
            manifestStore: createManifestStore(),
            workspace: createWorkspace({
                calls,
                stageResult: {
                    ok: true,
                    changedFiles: [{ status: 'M', path: '.agents/skills/alpha/SKILL.md' }],
                },
            }),
            gitService: {
                commitAndPushPublishChanges: (): { ok: true; commitSha: string | null } | PublishErrorResult => {
                    throw new Error('commit should not run during dry-run');
                },
            },
        });

        expect(service.executePublish({
            targetSource: 'upstream',
            lockSource: createLockSource(),
            resolvedCommit: 'abc123',
            plan: {
                items: [{
                    type: 'directory',
                    localPath: '/local/alpha',
                    targetPath: '.agents/skills/alpha',
                }],
                deleteItems: [],
                warnings: ['warn'],
                errors: [],
            },
            sourceInfo: createSourceInfo(),
            publishConfig: { branchPrefix: null, createPr: null },
            selectedNewSkills: ['Alpha'],
            selectedRemoveSkills: [],
            effectiveCreatePr: false,
            dryRun: true,
            message: null,
            branch: null,
            title: null,
            body: null,
        })).toEqual({
            ok: true,
            source: 'upstream',
            branch: 'publish/test',
            dryRun: true,
            changedFiles: [{ status: 'M', path: '.agents/skills/alpha/SKILL.md' }],
            warnings: ['warn'],
            newSkills: ['Alpha'],
            removeSkills: [],
            createPr: false,
            message: 'Dry-run completed.',
        });
        expect(calls).toEqual([
            'prepare',
            'stage',
            'cleanup:/tmp/clone',
        ]);
    });

    test('commits staged changes and builds completed publish result', () => {
        const calls: string[] = [];
        const service = new PublishService({
            backend: createBackend(),
            manifestStore: createManifestStore(),
            workspace: createWorkspace({
                calls,
                stageResult: {
                    ok: true,
                    changedFiles: [{ status: 'A', path: '.agents/skills/beta/SKILL.md' }],
                },
            }),
            gitService: {
                commitAndPushPublishChanges: (): { ok: true; commitSha: string | null } | PublishErrorResult => {
                    calls.push('commit');
                    return { ok: true, commitSha: 'commit123' };
                },
            },
            resultBuilder: {
                buildBase(input: Parameters<PublishResultBuilder['buildBase']>[0]): ReturnType<PublishResultBuilder['buildBase']> {
                    return new PublishResultBuilder().buildBase(input);
                },
                buildCompleted(input: Parameters<PublishResultBuilder['buildCompleted']>[0]): ReturnType<PublishResultBuilder['buildCompleted']> {
                    return new PublishResultBuilder().buildCompleted(input);
                },
                resolveMetadata(): ReturnType<PublishResultBuilder['resolveMetadata']> {
                    calls.push('metadata');
                    return {
                        baseBranch: 'main',
                        compareUrl: 'https://github.com/owner/repo/compare/main...publish%2Ftest?expand=1',
                        pr: null,
                        warnings: ['metadata warning'],
                    };
                },
            },
        });

        expect(service.executePublish({
            targetSource: 'upstream',
            lockSource: createLockSource(),
            resolvedCommit: 'abc123',
            plan: {
                items: [{
                    type: 'directory',
                    localPath: '/local/beta',
                    targetPath: '.agents/skills/beta',
                }],
                deleteItems: [],
                warnings: ['plan warning'],
                errors: [],
            },
            sourceInfo: createSourceInfo(),
            publishConfig: { branchPrefix: null, createPr: null },
            selectedNewSkills: ['Beta'],
            selectedRemoveSkills: [],
            effectiveCreatePr: true,
            dryRun: false,
            message: 'commit message',
            branch: 'publish/test',
            title: null,
            body: null,
        })).toEqual({
            ok: true,
            source: 'upstream',
            branch: 'publish/test',
            baseBranch: 'main',
            dryRun: false,
            changedFiles: [{ status: 'A', path: '.agents/skills/beta/SKILL.md' }],
            commitSha: 'commit123',
            compareUrl: 'https://github.com/owner/repo/compare/main...publish%2Ftest?expand=1',
            pr: null,
            warnings: ['metadata warning'],
            newSkills: ['Beta'],
            removeSkills: [],
            createPr: true,
            message: 'Publish completed.',
        });
        expect(calls).toEqual([
            'prepare',
            'stage',
            'commit',
            'metadata',
            'cleanup:/tmp/clone',
        ]);
    });

    test('cleans up clone when staging fails', () => {
        const calls: string[] = [];
        const stageFailure: PublishErrorResult = {
            ok: false,
            error: 'Failed to stage publish changes.',
            details: 'cannot add',
        };
        const service = new PublishService({
            backend: createBackend(),
            manifestStore: createManifestStore(),
            workspace: createWorkspace({
                calls,
                stageResult: stageFailure,
            }),
        });

        expect(service.executePublish({
            targetSource: 'upstream',
            lockSource: createLockSource(),
            resolvedCommit: 'abc123',
            plan: {
                items: [{
                    type: 'file',
                    localPath: '/local/shared.md',
                    targetPath: '.agents/skills/shared.md',
                }],
                deleteItems: [],
                warnings: [],
                errors: [],
            },
            sourceInfo: createSourceInfo(),
            publishConfig: { branchPrefix: null, createPr: null },
            selectedNewSkills: [],
            selectedRemoveSkills: [],
            effectiveCreatePr: false,
            dryRun: false,
            message: null,
            branch: null,
            title: null,
            body: null,
        })).toBe(stageFailure);
        expect(calls).toEqual([
            'prepare',
            'stage',
            'cleanup:/tmp/clone',
        ]);
    });
});

function createWorkspace({
    calls,
    stageResult,
}: {
    calls: string[];
    stageResult: StagePublishPlanResult;
}): {
    preparePublishWorkspace: () => { ok: true; cloneDir: string; branchName: string };
    stagePublishPlan: () => StagePublishPlanResult;
    cleanupTempDir: (dir: string | null | undefined) => void;
} {
    return {
        preparePublishWorkspace(): { ok: true; cloneDir: string; branchName: string } {
            calls.push('prepare');
            return { ok: true, cloneDir: '/tmp/clone', branchName: 'publish/test' };
        },
        stagePublishPlan(): StagePublishPlanResult {
            calls.push('stage');
            return stageResult;
        },
        cleanupTempDir(dir: string | null | undefined): void {
            calls.push(`cleanup:${dir ?? 'null'}`);
        },
    };
}

function createManifest(): ManifestData {
    return {
        agents: ['codex'],
        sources: [createSourceEntry()],
    };
}

function createSourceEntry(): ManifestSourceEntry {
    return {
        source: 'upstream',
        skills: null,
        publish: { branchPrefix: null, createPr: null },
    };
}

function createLock(): LockData {
    return {
        schemaVersion: 5,
        agents: ['codex'],
        sources: { upstream: createLockSource() },
    };
}

function createLockSource(): LockSourceMeta {
    return {
        mode: 'all',
        listedAt: '2026-06-05T00:00:00.000Z',
        skillEntries: [],
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

function createManifestStore(): { lockManagedSkills(): string[] } {
    return {
        lockManagedSkills(): string[] {
            return [];
        },
    };
}

function createBackend(): BackendLike {
    return {
        root: '/repo',
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
            return { ok: true, dirs: ['/repo/.agents/skills'] };
        },
        installSkillEntries(): ReturnType<BackendLike['installSkillEntries']> {
            return { ok: true, status: 0, cmd: ['fake-install'] };
        },
        removeSkillEntries(): ReturnType<BackendLike['removeSkillEntries']> {
            return { ok: true, status: 0, cmd: ['fake-remove'] };
        },
    };
}
