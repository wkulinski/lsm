import { describe, expect, test } from 'vitest';

import PublishWorkflow from '../src/core/manager/PublishWorkflow';
import type {
    LockData,
    ManagerErrorResult,
    ManagerEvent,
    ManagerHeader,
    ManifestData,
    PublishCommandOptions,
} from '../src/core/types';
import type {
    ManagerRuntime,
    ManifestRuntime,
} from '../src/core/manager/types';

interface FakeRuntime {
    manifestRuntime: ManifestRuntime;
    runtime: ManagerRuntime;
    publishInputs: unknown[];
    createExecutionRuntime: (manifestRuntime: ManifestRuntime) => ManagerRuntime | ManagerErrorResult;
}

describe('PublishWorkflow', () => {
    test('returns source selection error before creating execution runtime', () => {
        let createExecutionRuntimeCalls = 0;
        const manifestRuntime = createManifestRuntime({
            manifest: createManifest({
                sources: [
                    { source: 'owner/repo-a', skills: null, publish: { branchPrefix: null, createPr: null } },
                    { source: 'owner/repo-b', skills: null, publish: { branchPrefix: null, createPr: null } },
                ],
            }),
        });

        const result = new PublishWorkflow().run({
            manifestRuntime,
            options: { dryRun: true },
            createExecutionRuntime() {
                createExecutionRuntimeCalls += 1;
                return { status: 'error', exitCode: 1, error: 'should not be called' };
            },
        });

        expect(result).toEqual({
            status: 'error',
            exitCode: 1,
            error: 'Multiple sources configured. Use --source <source>.',
        });
        expect(createExecutionRuntimeCalls).toBe(0);
    });

    test('normalizes publish options and reports publish start before calling publisher', () => {
        const fake = createRuntime();
        const events: ManagerEvent[] = [];
        const options: PublishCommandOptions = {
            source: 'owner/repo-b',
            newSkills: ['Beta', ' ', 'Alpha', 'Beta'],
            removeSkills: ['Legacy', '', 'Legacy'],
            dryRun: true,
            confirmDeletes: true,
            createPr: false,
            message: 'Publish message',
            branch: 'publish/test',
            title: 'Publish title',
            body: 'Publish body',
        };

        const result = new PublishWorkflow().run({
            manifestRuntime: fake.manifestRuntime,
            options,
            report: event => events.push(event),
            createExecutionRuntime: fake.createExecutionRuntime,
        });

        expect(result).toMatchObject({
            status: 'completed',
            exitCode: 0,
            header: createHeader(),
            result: { ok: true, published: true },
        });
        expect(events).toEqual([
            { type: 'header', header: createHeader() },
            {
                type: 'publish-start',
                options: {
                    source: 'owner/repo-b',
                    newSkills: ['Beta', 'Alpha'],
                    removeSkills: ['Legacy'],
                    dryRun: true,
                    confirmDeletes: true,
                    createPr: false,
                },
            },
        ]);
        expect(fake.publishInputs).toEqual([{
            manifest: fake.runtime.manifest,
            lock: fake.runtime.lock,
            source: 'owner/repo-b',
            newSkills: ['Beta', 'Alpha'],
            removeSkills: ['Legacy'],
            dryRun: true,
            confirmDeletes: true,
            createPr: false,
            message: 'Publish message',
            branch: 'publish/test',
            title: 'Publish title',
            body: 'Publish body',
        }]);
    });

    test('returns publisher failure with header and details', () => {
        const fake = createRuntime({
            publishResult: {
                ok: false,
                error: 'Publish failed upstream.',
                details: { reason: 'git push failed' },
            },
        });

        const result = new PublishWorkflow().run({
            manifestRuntime: fake.manifestRuntime,
            options: { source: 'owner/repo-a' },
            createExecutionRuntime: fake.createExecutionRuntime,
        });

        expect(result).toEqual({
            status: 'error',
            exitCode: 1,
            error: 'Publish failed upstream.',
            details: { reason: 'git push failed' },
            header: createHeader(),
        });
    });
});

function createRuntime(
    {
        manifest = createManifest(),
        lock = createLock(),
        publishResult = { ok: true, published: true },
    }: {
        manifest?: ManifestData;
        lock?: LockData;
        publishResult?: unknown;
    } = {},
): FakeRuntime {
    const publishInputs: unknown[] = [];
    const manifestRuntime = createManifestRuntime({ manifest, lock });
    const publisher = {
        publish(input: unknown): unknown {
            publishInputs.push(input);
            return publishResult;
        },
    };
    const runtime: ManagerRuntime = {
        ...manifestRuntime,
        header: createHeader(),
        backend: { root: '/tmp/project' } as unknown as ManagerRuntime['backend'],
        sync: {} as unknown as ManagerRuntime['sync'],
        publisher: publisher as unknown as ManagerRuntime['publisher'],
    };

    return {
        manifestRuntime,
        runtime,
        publishInputs,
        createExecutionRuntime(inputManifestRuntime: ManifestRuntime): ManagerRuntime {
            expect(inputManifestRuntime).toBe(manifestRuntime);
            return runtime;
        },
    };
}

function createManifestRuntime(
    {
        manifest = createManifest(),
        lock = createLock(),
    }: {
        manifest?: ManifestData;
        lock?: LockData;
    } = {},
): ManifestRuntime {
    return {
        root: '/tmp/project',
        manifestPath: '/tmp/project/skills.json',
        lockPath: '/tmp/project/skills.lock.json',
        manifestStore: {} as unknown as ManifestRuntime['manifestStore'],
        manifest,
        lock,
    };
}

function createManifest(
    {
        sources = [
            { source: 'owner/repo-a', skills: null, publish: { branchPrefix: null, createPr: null } },
            { source: 'owner/repo-b', skills: null, publish: { branchPrefix: null, createPr: null } },
        ],
    }: {
        sources?: ManifestData['sources'];
    } = {},
): ManifestData {
    return {
        agents: ['codex'],
        sources,
    };
}

function createLock(): LockData {
    return {
        schemaVersion: 5,
        agents: ['codex'],
        sources: {},
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
