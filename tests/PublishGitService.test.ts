import { describe, expect, test } from 'vitest';

import PublishGitService, { type PublishGitRunner } from '../src/core/publish/PublishGitService';

describe('PublishGitService', () => {
    test('commits, reads commit sha, and pushes publish branch', () => {
        const calls: { cwd: string; args: string[] }[] = [];
        const service = new PublishGitService({
            gitRunner: createGitRunner(calls, {
                revParseStdout: 'abc123\n',
            }),
        });

        expect(service.commitAndPushPublishChanges({
            cloneDir: '/tmp/clone',
            branchName: 'publish/test',
            message: 'custom message',
        })).toEqual({
            ok: true,
            commitSha: 'abc123',
        });
        expect(calls).toEqual([
            {
                cwd: '/tmp/clone',
                args: ['commit', '-m', 'custom message'],
            },
            {
                cwd: '/tmp/clone',
                args: ['rev-parse', 'HEAD'],
            },
            {
                cwd: '/tmp/clone',
                args: ['push', '-u', 'origin', 'publish/test'],
            },
        ]);
    });

    test('returns commit and push failures with command output details', () => {
        expect(new PublishGitService({
            gitRunner: createGitRunner([], {
                commitOk: false,
                commitStderr: 'commit failed',
            }),
        }).commitAndPushPublishChanges({
            cloneDir: '/tmp/clone',
            branchName: 'publish/test',
            message: null,
        })).toEqual({
            ok: false,
            error: 'Failed to create publish commit.',
            details: 'commit failed',
        });

        expect(new PublishGitService({
            gitRunner: createGitRunner([], {
                pushOk: false,
                pushStdout: 'push failed',
            }),
        }).commitAndPushPublishChanges({
            cloneDir: '/tmp/clone',
            branchName: 'publish/test',
            message: null,
        })).toEqual({
            ok: false,
            error: 'Failed to push publish branch.',
            details: 'push failed',
        });
    });

    test('uses null commit sha when rev-parse fails but commit and push succeed', () => {
        const service = new PublishGitService({
            gitRunner: createGitRunner([], {
                revParseOk: false,
            }),
        });

        expect(service.commitAndPushPublishChanges({
            cloneDir: '/tmp/clone',
            branchName: 'publish/test',
            message: null,
        })).toEqual({
            ok: true,
            commitSha: null,
        });
    });

    test('detects origin head branch and builds compare urls', () => {
        const service = new PublishGitService({
            gitRunner: createGitRunner([], {
                originHeadStdout: 'origin/main\n',
            }),
        });

        expect(service.detectOriginHeadBranch('/tmp/clone')).toBe('main');
        expect(service.buildCompareUrl(
            'https://github.com/owner/repo',
            'release/1.0',
            'publish/test branch',
        )).toBe('https://github.com/owner/repo/compare/release%2F1.0...publish%2Ftest%20branch?expand=1');
        expect(service.buildCompareUrl(null, 'main', 'publish/test')).toBeNull();
    });

    test('uses the default commit message for an empty message', () => {
        const calls: { cwd: string; args: string[] }[] = [];
        const service = new PublishGitService({ gitRunner: createGitRunner(calls, {}) });

        service.commitAndPushPublishChanges({
            cloneDir: '/tmp/clone',
            branchName: 'publish/test',
            message: '   ',
        });

        expect(calls[0]?.args).toEqual(['commit', '-m', 'chore(skills): publish managed skills']);
    });
});

function createGitRunner(
    calls: { cwd: string; args: string[] }[],
    {
        commitOk = true,
        commitStderr = '',
        pushOk = true,
        pushStdout = '',
        revParseOk = true,
        revParseStdout = '',
        originHeadOk = true,
        originHeadStdout = '',
    }: {
        commitOk?: boolean;
        commitStderr?: string;
        pushOk?: boolean;
        pushStdout?: string;
        revParseOk?: boolean;
        revParseStdout?: string;
        originHeadOk?: boolean;
        originHeadStdout?: string;
    },
): PublishGitRunner {
    return (cwd: string, args: string[]) => {
        calls.push({ cwd, args });
        const command = args.join(' ');
        if (command.startsWith('commit -m ')) {
            return {
                ok: commitOk,
                status: commitOk ? 0 : 1,
                stdout: '',
                stderr: commitStderr,
            };
        }
        if (command === 'rev-parse HEAD') {
            return {
                ok: revParseOk,
                status: revParseOk ? 0 : 1,
                stdout: revParseStdout,
                stderr: '',
            };
        }
        if (command.startsWith('push -u origin ')) {
            return {
                ok: pushOk,
                status: pushOk ? 0 : 1,
                stdout: pushStdout,
                stderr: '',
            };
        }
        if (command === 'symbolic-ref refs/remotes/origin/HEAD --short') {
            return {
                ok: originHeadOk,
                status: originHeadOk ? 0 : 1,
                stdout: originHeadStdout,
                stderr: '',
            };
        }
        return {
            ok: false,
            status: 1,
            stdout: '',
            stderr: `Unexpected git command: ${command}`,
        };
    };
}
