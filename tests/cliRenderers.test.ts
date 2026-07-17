import { afterEach, describe, expect, test, vi } from 'vitest';

import { printError, printErrorDetails } from '../src/cli/renderers/errorRenderer';
import { renderPublishEvent, renderPublishResult } from '../src/cli/renderers/publishRenderer';
import { renderSyncEvent, renderSyncResult } from '../src/cli/renderers/syncRenderer';
import type {
    ManagerEvent,
    ManagerHeader,
    PublishCommandResult,
    SharedSyncResult,
    SyncCommandResult,
    SyncPlan,
    SyncPreflight,
} from '../src/core/types';

const header: ManagerHeader = {
    root: '/tmp/project',
    cliVersion: '0.1.0',
    manifestPath: '/tmp/project/skills.json',
    manifestRelativePath: 'skills.json',
    lockPath: '/tmp/project/skills.lock.json',
    lockRelativePath: 'skills.lock.json',
    agents: ['codex', 'claude'],
};

const plan: SyncPlan = {
    oldAgents: ['codex'],
    newAgents: ['codex', 'claude'],
    agentsUnion: ['codex', 'claude'],
    agentsRemoved: [],
    oldManaged: ['old-skill'],
    oldManagedEntries: [],
    newManaged: ['new-skill'],
    skillsRemoved: ['old-skill'],
    skillsRemovedEntries: [],
};

const preflight: SyncPreflight = {
    ok: true,
    conflicts: [
        {
            path: 'skills/example/SKILL.md',
            reason: 'modified-managed',
            operation: 'overwrite',
            scope: 'skill',
            source: 'owner/repo',
            skill: 'example',
        },
        {
            path: 'shared/config.json',
            reason: 'missing-baseline-hash',
            operation: 'delete',
            scope: 'shared',
            source: null,
            skill: null,
        },
        {
            path: 'other/file',
            reason: 'unmanaged-existing-path',
            operation: 'overwrite',
            scope: 'skill',
            source: null,
            skill: null,
        },
        {
            path: 'unknown',
            reason: 'custom-reason',
            operation: 'overwrite',
            scope: 'skill',
            source: null,
            skill: null,
        },
    ],
};

const shared: SharedSyncResult = {
    sharedFailed: false,
    managedNewLocalPaths: { 'owner/repo': ['config.json'] },
    sharedStats: { 'owner/repo': { declaredFiles: 2, copiedFiles: 1 } },
    sharedFileHashesBySource: {},
    removedFiles: 1,
    errors: [],
};

function captureOutput(): { readonly stdout: string; readonly stderr: string } {
    let stdout = '';
    let stderr = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
        stdout += String(chunk);
        return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
        stderr += String(chunk);
        return true;
    });

    return {
        get stdout(): string {
            return stdout;
        },
        get stderr(): string {
            return stderr;
        },
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('error renderer', () => {
    test('renders string, conflict list, command details and unknown values', () => {
        const output = captureOutput();

        printError({ status: 'error', exitCode: 1, error: 'failed', details: '  details  ' }, 'Custom');
        printErrorDetails([
            { skill: 'one', a: 'codex', b: 'claude' },
            { unexpected: true },
        ]);
        printErrorDetails({ status: 2, cmd: ['git', 'status'] });
        printErrorDetails(null);

        expect(output.stderr).toContain('Custom: failed');
        expect(output.stderr).toContain('details');
        expect(output.stderr).toContain('"one" in: codex AND claude');
        expect(output.stderr).toContain('{"unexpected":true}');
        expect(output.stderr).toContain('exit=2');
        expect(output.stderr).toContain('cmd: git status');
        expect(output.stderr).toContain('null');
    });

    test('renders empty and non-string details', () => {
        const output = captureOutput();

        printErrorDetails('   ');
        printErrorDetails([]);
        printErrorDetails({ status: 1 });
        printErrorDetails(42);

        expect(output.stderr).toContain('exit=1');
        expect(output.stderr).toContain('42\n');
    });
});

describe('publish renderer', () => {
    test('renders publish-start with all option combinations', () => {
        const output = captureOutput();
        renderPublishEvent({
            type: 'publish-start',
            options: {
                source: 'owner/repo',
                newSkills: ['one'],
                removeSkills: ['old'],
                dryRun: true,
                confirmDeletes: true,
                createPr: false,
            },
        });
        renderPublishEvent({
            type: 'publish-start',
            options: {
                source: null,
                newSkills: [],
                removeSkills: [],
                dryRun: false,
                confirmDeletes: false,
                createPr: null,
            },
        });

        expect(output.stdout).toContain('Source     : owner/repo');
        expect(output.stdout).toContain('New skills : one');
        expect(output.stdout).toContain('Remove skills: old');
        expect(output.stdout).toContain('Dry-run    : yes');
        expect(output.stdout).toContain('Confirm deletes: yes');
        expect(output.stdout).toContain('Create PR  : no (forced)');
        expect(output.stdout).toContain('Source     : (auto: single source)');
        expect(output.stdout).toContain('Create PR  : auto from manifest');
    });

    test('renders created, error and completed results', () => {
        const output = captureOutput();
        const completed: PublishCommandResult = {
            status: 'completed',
            exitCode: 0,
            header,
            result: {
                source: 'owner/repo',
                branch: 'lsm/update',
                baseBranch: 'main',
                commitSha: 'abc123',
                changedFiles: [
                    { status: 'M', path: 'skills/one/SKILL.md' },
                    { invalid: true },
                ],
                compareUrl: 'https://github.com/compare',
                pr: { url: 'https://github.com/pr/1' },
                newSkills: ['one'],
                removeSkills: [],
                createPr: true,
                warnings: ['warning'],
                message: 'Published successfully',
            },
        };

        expect(renderPublishResult({ status: 'templates-created', exitCode: 1, root: '/tmp', createdTemplates: ['skills.json'] })).toBe(1);
        expect(renderPublishResult({ status: 'error', exitCode: 1, error: 'Publish failed', details: { status: 1 } })).toBe(1);
        expect(renderPublishResult(completed)).toBe(0);

        expect(output.stdout).toContain('skills.json');
        expect(output.stdout).toContain('Publish source : owner/repo');
        expect(output.stdout).toContain('Changed files  : 2');
        expect(output.stdout).toContain('[M] skills/one/SKILL.md');
        expect(output.stdout).toContain('PR URL         : https://github.com/pr/1');
        expect(output.stdout).toContain('Warnings:');
        expect(output.stdout).toContain('Published successfully');
        expect(output.stderr).toContain('Publish failed');
    });
});

describe('sync renderer', () => {
    test('renders every manager event', () => {
        const output = captureOutput();
        const events: ManagerEvent[] = [
            { type: 'header', header },
            { type: 'sync-discover-start' },
            { type: 'sync-plan', plan },
            { type: 'sync-preflight', preflight, force: true },
            { type: 'sync-add-start' },
            { type: 'sync-add-source', source: 'owner/repo', mode: 'all', skillCount: 2 },
            { type: 'sync-shared-start' },
            { type: 'sync-remove-start', plan },
            { type: 'publish-start', options: { source: null, newSkills: [], removeSkills: [], dryRun: false, confirmDeletes: false, createPr: null } },
        ];

        events.forEach(renderSyncEvent);

        expect(output.stdout).toContain('== Skills sync ==');
        expect(output.stdout).toContain('-- Discovering skills');
        expect(output.stdout).toContain('Managed(old): 1');
        expect(output.stdout).toContain('modified managed file');
        expect(output.stdout).toContain('Continuing because --force was provided.');
        expect(output.stdout).toContain('>>> Source: owner/repo');
        expect(output.stdout).toContain('-- Syncing shared files');
        expect(output.stdout).toContain('-- Pruning removed/missing skills');
    });

    test('renders all result statuses and summaries', () => {
        const output = captureOutput();
        const installs = [
            { source: 'owner/ok', ok: true },
            { source: 'owner/fail', ok: false, status: 2, cmd: ['git', 'clone'] },
        ];

        const results: SyncCommandResult[] = [
            { status: 'templates-created', exitCode: 1, root: '/tmp', createdTemplates: ['skills.json'] },
            { status: 'error', exitCode: 1, error: 'sync failed', details: 'details' },
            { status: 'cancelled', exitCode: 1, header, plan, preflight },
            { status: 'add-failed', exitCode: 1, header, plan, preflight, installs },
            {
                status: 'shared-failed',
                exitCode: 1,
                header,
                plan,
                preflight,
                installs,
                shared: { ...shared, errors: [{ source: 'owner/repo', message: 'Shared failed', details: [{ filePath: 'a', a: 'one', b: 'two' }] }] },
            },
            {
                status: 'completed',
                exitCode: 0,
                header,
                plan,
                preflight,
                missingRequested: [{ source: 'owner/repo', skill: 'missing' }],
                installs,
                shared: { ...shared, sharedStats: {}, managedNewLocalPaths: {} },
                removal: { removedFromRemovedAgents: 0, prunedSkills: 1, removedAgents: [], agentsUnion: ['codex'], hadNothingToPrune: false },
                lockWritten: true,
            },
        ];

        results.forEach((result) => {
            expect(renderSyncResult(result)).toBe(result.exitCode);
        });

        expect(output.stdout).toContain('Sync cancelled.');
        expect(output.stdout).toContain('Aborting before removals because installs failed.');
        expect(output.stdout).toContain('Aborting before removals because shared file sync failed.');
        expect(output.stdout).toContain('== Shared files summary ==');
        expect(output.stdout).toContain('owner/repo: "missing"');
        expect(output.stdout).toContain('Lock updated: skills.lock.json');
        expect(output.stderr).toContain('Shared failed owner/repo');
        expect(output.stderr).toContain('"a" in: one AND two');
    });

    test('renders the empty shared summary and lock-not-updated outcome', () => {
        const output = captureOutput();
        renderSyncResult({
            status: 'completed',
            exitCode: 0,
            header,
            plan: { ...plan, agentsRemoved: ['old-agent'], oldManaged: ['old-skill'] },
            preflight: { ok: true, conflicts: [] },
            missingRequested: [],
            installs: [],
            shared: { ...shared, sharedStats: {}, removedFiles: 0 },
            removal: { removedFromRemovedAgents: 1, prunedSkills: 0, removedAgents: ['old-agent'], agentsUnion: ['codex'], hadNothingToPrune: false },
            lockWritten: false,
        });

        expect(output.stdout).toContain('No shared files declared.');
        expect(output.stdout).toContain('OK  : 0/0');
        expect(output.stdout).toContain('Lock NOT updated');
    });
});
