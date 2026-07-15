import { describe, expect, test } from 'vitest';

import PullRequestService, { type GhRunner } from '../src/core/publish/PullRequestService';
import type { ResolvedSource } from '../src/core/types';

describe('PullRequestService', () => {
    test('skips PR creation when createPr is disabled', () => {
        const calls: { args: string[]; cwd: string | null }[] = [];
        const service = new PullRequestService({ ghRunner: createGhRunner(calls) });

        expect(service.createPublishPr({
            cloneDir: '/tmp/clone',
            sourceInfo: createSourceInfo(),
            baseBranch: 'main',
            branchName: 'publish/test',
            resolvedCommit: 'abc123',
            selectedNewSkills: [],
            selectedRemoveSkills: [],
            effectiveCreatePr: false,
            title: null,
            body: null,
        })).toEqual({ pr: null, warnings: [] });
        expect(calls).toEqual([]);
    });

    test('returns warning with compare URL when gh is unavailable', () => {
        const service = new PullRequestService({
            ghRunner: createGhRunner([], { authOk: false }),
        });

        expect(service.createPublishPr({
            cloneDir: '/tmp/clone',
            sourceInfo: createSourceInfo(),
            baseBranch: 'main',
            branchName: 'publish/test',
            resolvedCommit: 'abc123',
            selectedNewSkills: [],
            selectedRemoveSkills: [],
            effectiveCreatePr: true,
            title: null,
            body: null,
        })).toEqual({
            pr: null,
            warnings: ['gh CLI is not available or not authenticated; PR was not created automatically.'],
        });
        expect(service.createPullRequest({
            cwd: '/tmp/clone',
            sourceInfo: createSourceInfo(),
            baseBranch: 'main',
            branchName: 'publish/test',
            title: 'Title',
            body: 'Body',
        })).toEqual({
            ok: false,
            error: 'gh CLI is not available or not authenticated; PR was not created automatically.',
            compareUrl: 'https://github.com/owner/repo/compare/main...publish%2Ftest?expand=1',
        });
    });

    test('creates a PR and extracts the GitHub URL from command output', () => {
        const calls: { args: string[]; cwd: string | null }[] = [];
        const service = new PullRequestService({
            ghRunner: createGhRunner(calls, {
                prStdout: 'Created pull request https://github.com/owner/repo/pull/123\n',
            }),
        });

        expect(service.createPublishPr({
            cloneDir: '/tmp/clone',
            sourceInfo: createSourceInfo(),
            baseBranch: 'main',
            branchName: 'publish/test',
            resolvedCommit: 'abc123',
            selectedNewSkills: ['Alpha'],
            selectedRemoveSkills: ['Old'],
            effectiveCreatePr: true,
            title: 'Custom title',
            body: 'Custom body',
        })).toEqual({
            pr: {
                ok: true,
                url: 'https://github.com/owner/repo/pull/123',
                output: 'Created pull request https://github.com/owner/repo/pull/123',
            },
            warnings: [],
        });
        expect(calls).toEqual([
            { args: ['auth', 'status'], cwd: null },
            {
                args: [
                    'pr',
                    'create',
                    '--base',
                    'main',
                    '--head',
                    'publish/test',
                    '--title',
                    'Custom title',
                    '--body',
                    'Custom body',
                ],
                cwd: '/tmp/clone',
            },
        ]);
    });

    test('returns PR creation failure with stderr and compare URL', () => {
        const service = new PullRequestService({
            ghRunner: createGhRunner([], {
                prOk: false,
                prStderr: 'could not create pr',
            }),
        });

        expect(service.createPullRequest({
            cwd: '/tmp/clone',
            sourceInfo: createSourceInfo(),
            baseBranch: 'main',
            branchName: 'publish/test',
            title: 'Title',
            body: 'Body',
        })).toEqual({
            ok: false,
            error: 'Failed to create PR automatically: could not create pr',
            compareUrl: 'https://github.com/owner/repo/compare/main...publish%2Ftest?expand=1',
        });
    });

    test('builds default PR body with selected skill lists', () => {
        const service = new PullRequestService();

        expect(service.defaultPrBody({
            resolvedCommit: 'abc123',
            newSkills: ['Alpha', 'Beta'],
            removeSkills: ['Old'],
        })).toBe([
            'Published automatically using Llm Skills Manager (wkulinski/lsm).',
            '',
            'Base commit from lock: abc123',
            'Selected new skills: Alpha, Beta',
            'Selected removed skills: Old',
        ].join('\n'));
        expect(service.defaultPrBody({
            resolvedCommit: 'abc123',
            newSkills: [],
            removeSkills: [],
        })).toContain('Selected new skills: none');
    });

    test('uses default title and body for empty values', () => {
        const calls: { args: string[]; cwd: string | null }[] = [];
        const service = new PullRequestService({
            ghRunner: createGhRunner(calls, {
                prStdout: 'https://github.com/owner/repo/pull/123\n',
            }),
        });

        service.createPublishPr({
            cloneDir: '/tmp/clone',
            sourceInfo: createSourceInfo(),
            baseBranch: 'main',
            branchName: 'publish/test',
            resolvedCommit: 'abc123',
            selectedNewSkills: [],
            selectedRemoveSkills: [],
            effectiveCreatePr: true,
            title: '   ',
            body: '   ',
        });

        expect(calls[1]?.args).toContain('chore(skills): publish managed skills');
        expect(calls[1]?.args.join('\n')).toContain('Base commit from lock: abc123');
    });
});

function createGhRunner(
    calls: { args: string[]; cwd: string | null }[],
    {
        authOk = true,
        prOk = true,
        prStdout = '',
        prStderr = '',
    }: {
        authOk?: boolean;
        prOk?: boolean;
        prStdout?: string;
        prStderr?: string;
    } = {},
): GhRunner {
    return (args, options = {}) => {
        calls.push({ args, cwd: options.cwd ?? null });
        const command = args.join(' ');
        if (command === 'auth status') {
            return {
                status: authOk ? 0 : 1,
                stdout: '',
                stderr: '',
            };
        }
        if (command.startsWith('pr create ')) {
            return {
                status: prOk ? 0 : 1,
                stdout: prStdout,
                stderr: prStderr,
            };
        }
        return {
            status: 1,
            stdout: '',
            stderr: `Unexpected gh command: ${command}`,
        };
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
