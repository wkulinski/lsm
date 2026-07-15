import { describe, expect, test } from 'vitest';

import SyncWorkflow from '../src/core/manager/SyncWorkflow';
import type {
    DiscoveredSources,
    LockData,
    ManagerEvent,
    ManagerHeader,
    ManifestData,
    SharedSyncResult,
    SkillEntry,
    SyncInstallResult,
    SyncPlan,
    SyncPreflight,
    SyncRemovalSummary,
} from '../src/core/types';
import type { ManagerRuntime } from '../src/core/manager/types';

interface FakeRuntime {
    runtime: ManagerRuntime;
    calls: string[];
    lockWrites: Parameters<ManagerRuntime['manifestStore']['writeLock']>[0][];
}

describe('SyncWorkflow', () => {
    test('runs the full sync flow and writes lock on success', async () => {
        const { runtime, calls, lockWrites } = createRuntime();
        const events: ManagerEvent[] = [];

        const result = await new SyncWorkflow().run({
            runtime,
            report: event => events.push(event),
        });

        expect(result).toMatchObject({
            status: 'completed',
            exitCode: 0,
            missingRequested: [],
            lockWritten: true,
        });
        expect(calls).toEqual([
            'discover',
            'assertNoConflicts',
            'planRemovals',
            'collectLocalChangeConflicts',
            'addPhase',
            'syncSharedFilesPhase',
            'removePhase',
        ]);
        expect(events.map(event => event.type)).toEqual([
            'header',
            'sync-discover-start',
            'sync-plan',
            'sync-add-start',
            'sync-add-source',
            'sync-shared-start',
            'sync-remove-start',
        ]);
        expect(lockWrites).toHaveLength(1);
        const writtenLock = lockWrites[0];
        expect(writtenLock.agents).toEqual(['codex']);
        const upstreamLockSource = writtenLock.sources.upstream;
        expect(upstreamLockSource).toBeDefined();
        expect(upstreamLockSource.mode).toBe('all');
        expect(upstreamLockSource.skillEntries).toEqual([{
            name: 'Alpha',
            sourcePath: '.agents/skills/alpha',
            sharedFiles: ['.agents/skills/shared/alpha.md'],
            hash: null,
        }]);
        expect(upstreamLockSource.sharedFileHashes).toEqual([{ path: '.agents/skills/shared/alpha.md', sha256: 'shared-hash' }]);
    });

    test('does not write lock when requested skills are missing', async () => {
        const { runtime, lockWrites } = createRuntime({
            missingRequested: [{ source: 'upstream', skill: 'Missing' }],
        });

        const result = await new SyncWorkflow().run({ runtime });

        expect(result).toMatchObject({
            status: 'completed',
            exitCode: 1,
            missingRequested: [{ source: 'upstream', skill: 'Missing' }],
            lockWritten: false,
        });
        expect(lockWrites).toEqual([]);
    });

    test('returns add-failed and stops before shared sync when install fails', async () => {
        const { runtime, calls, lockWrites } = createRuntime({
            addResult: {
                installs: [{ source: 'upstream', ok: false, status: 1, cmd: ['fake-install'] }],
                addFailed: true,
            },
        });

        const result = await new SyncWorkflow().run({ runtime });

        expect(result).toMatchObject({
            status: 'add-failed',
            exitCode: 1,
            installs: [{ source: 'upstream', ok: false, status: 1, cmd: ['fake-install'] }],
        });
        expect(calls).not.toContain('syncSharedFilesPhase');
        expect(calls).not.toContain('removePhase');
        expect(lockWrites).toEqual([]);
    });

    test('returns shared-failed and stops before removals when shared sync fails', async () => {
        const { runtime, calls, lockWrites } = createRuntime({
            shared: createSharedResult({
                sharedFailed: true,
                errors: [{ message: 'shared failed' }],
            }),
        });

        const result = await new SyncWorkflow().run({ runtime });

        expect(result).toMatchObject({
            status: 'shared-failed',
            exitCode: 1,
            shared: {
                sharedFailed: true,
                errors: [{ message: 'shared failed' }],
            },
        });
        expect(calls).not.toContain('removePhase');
        expect(lockWrites).toEqual([]);
    });

    test('returns error when preflight conflicts require confirmation but no handler is provided', async () => {
        const { runtime, calls } = createRuntime({
            preflight: createPreflight({
                conflicts: [createConflict()],
            }),
        });

        const result = await new SyncWorkflow().run({ runtime });

        expect(result).toMatchObject({
            status: 'error',
            exitCode: 1,
            error: 'Local change conflicts detected, but no confirmation handler was provided.',
        });
        expect(calls).not.toContain('addPhase');
    });

    test('returns cancelled when preflight confirmation is rejected', async () => {
        const { runtime, calls } = createRuntime({
            preflight: createPreflight({
                conflicts: [createConflict()],
            }),
        });

        const result = await new SyncWorkflow().run({
            runtime,
            options: {
                confirmLocalChanges: () => false,
            },
        });

        expect(result).toMatchObject({
            status: 'cancelled',
            exitCode: 1,
            preflight: {
                conflicts: [createConflict()],
            },
        });
        expect(calls).not.toContain('addPhase');
    });
});

function createRuntime(
    {
        discovered = createDiscoveredSources(),
        missingRequested = [],
        preflight = createPreflight(),
        addResult = {
            installs: [{ source: 'upstream', ok: true, status: 0, cmd: ['fake-install'] }],
            addFailed: false,
        },
        shared = createSharedResult(),
        removal = createRemovalSummary(),
    }: {
        discovered?: DiscoveredSources;
        missingRequested?: { source: string; skill: string }[];
        preflight?: SyncPreflight;
        addResult?: { installs: SyncInstallResult[]; addFailed: boolean };
        shared?: SharedSyncResult;
        removal?: SyncRemovalSummary;
    } = {},
): FakeRuntime {
    const calls: string[] = [];
    const lockWrites: Parameters<ManagerRuntime['manifestStore']['writeLock']>[0][] = [];
    const manifest = createManifest();
    const lock = createLock();
    const plan = createPlan();

    const sync = {
        discover(inputManifest: ManifestData): { discovered: DiscoveredSources; missingRequested: { source: string; skill: string }[] } {
            calls.push('discover');
            expect(inputManifest).toBe(manifest);
            return { discovered, missingRequested };
        },
        assertNoConflicts(inputDiscovered: DiscoveredSources): void {
            calls.push('assertNoConflicts');
            expect(inputDiscovered).toBe(discovered);
        },
        planRemovals(input: { lock: LockData; manifest: ManifestData; discovered: DiscoveredSources }): SyncPlan {
            calls.push('planRemovals');
            expect(input).toEqual({ lock, manifest, discovered });
            return plan;
        },
        collectLocalChangeConflicts(input: {
            manifest: ManifestData;
            lock: LockData;
            discovered: DiscoveredSources;
            plan?: Partial<SyncPlan>;
        }): SyncPreflight {
            calls.push('collectLocalChangeConflicts');
            expect(input).toEqual({ manifest, lock, discovered, plan });
            return preflight;
        },
        addPhase(inputDiscovered: DiscoveredSources, agents: string[]): { installs: SyncInstallResult[]; addFailed: boolean } {
            calls.push('addPhase');
            expect(inputDiscovered).toBe(discovered);
            expect(agents).toEqual(['codex']);
            return addResult;
        },
        syncSharedFilesPhase(input: { manifest: ManifestData; lock: LockData; discovered: DiscoveredSources }): SharedSyncResult {
            calls.push('syncSharedFilesPhase');
            expect(input).toEqual({ manifest, lock, discovered });
            return shared;
        },
        removePhase(inputPlan: SyncPlan): SyncRemovalSummary {
            calls.push('removePhase');
            expect(inputPlan).toBe(plan);
            return removal;
        },
    };
    const manifestStore = {
        writeLock(input: Parameters<ManagerRuntime['manifestStore']['writeLock']>[0]): void {
            lockWrites.push(input);
        },
    };

    return {
        calls,
        lockWrites,
        runtime: {
            root: '/tmp/project',
            manifestPath: '/tmp/project/skills.json',
            lockPath: '/tmp/project/skills.lock.json',
            header: createHeader(),
            manifestStore: manifestStore as unknown as ManagerRuntime['manifestStore'],
            backend: { root: '/tmp/project' } as unknown as ManagerRuntime['backend'],
            sync: sync as unknown as ManagerRuntime['sync'],
            publisher: {} as unknown as ManagerRuntime['publisher'],
            manifest,
            lock,
        },
    };
}

function createHeader(): ManagerHeader {
    return {
        root: '/tmp/project',
        cliVersion: '0.0.0-test',
        manifestPath: '/tmp/project/skills.json',
        manifestRelativePath: 'skills.json',
        lockPath: '/tmp/project/skills.lock.json',
        lockRelativePath: 'skills.lock.json',
        agents: ['codex'],
    };
}

function createManifest(): ManifestData {
    return {
        agents: ['codex'],
        sources: [{ source: 'upstream', skills: null, publish: { branchPrefix: null, createPr: null } }],
    };
}

function createLock(): LockData {
    return {
        schemaVersion: 5,
        agents: ['codex'],
        sources: {},
    };
}

function createPlan(): SyncPlan {
    return {
        oldAgents: ['codex'],
        newAgents: ['codex'],
        agentsUnion: ['codex'],
        agentsRemoved: [],
        oldManaged: [],
        oldManagedEntries: [],
        newManaged: ['Alpha'],
        skillsRemoved: [],
        skillsRemovedEntries: [],
    };
}

function createPreflight({ conflicts = [] }: { conflicts?: SyncPreflight['conflicts'] } = {}): SyncPreflight {
    return {
        ok: true,
        conflicts,
    };
}

function createConflict(): SyncPreflight['conflicts'][number] {
    return {
        path: '.agents/skills/alpha/SKILL.md',
        reason: 'modified-managed',
        operation: 'overwrite',
        scope: 'skill-file',
        source: 'upstream',
        skill: 'Alpha',
    };
}

function createSharedResult({
    sharedFailed = false,
    errors = [],
}: Partial<SharedSyncResult> = {}): SharedSyncResult {
    return {
        sharedFailed,
        managedNewLocalPaths: { upstream: ['.agents/skills/shared/alpha.md'] },
        sharedStats: { upstream: { declaredFiles: 1, copiedFiles: 1 } },
        sharedFileHashesBySource: {
            upstream: [{ path: '.agents/skills/shared/alpha.md', sha256: 'shared-hash' }],
        },
        removedFiles: 0,
        errors,
    };
}

function createRemovalSummary(): SyncRemovalSummary {
    return {
        removedFromRemovedAgents: 0,
        prunedSkills: 0,
        removedAgents: [],
        agentsUnion: ['codex'],
        hadNothingToPrune: true,
    };
}

function createDiscoveredSources(): DiscoveredSources {
    const skillEntry = createSkillEntry({
        name: 'Alpha',
        sourcePath: '.agents/skills/alpha',
        sharedFiles: ['.agents/skills/shared/alpha.md'],
    });

    return {
        upstream: {
            mode: 'all',
            listedAt: '2026-06-05T00:00:00.000Z',
            skills: ['Alpha'],
            skillEntries: [skillEntry],
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
