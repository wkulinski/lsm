import { describe, expect, test } from 'vitest';

import PublishGitService, { type PublishGitRunner } from '../src/core/publish/PublishGitService';
import PublishResultBuilder from '../src/core/publish/PublishResultBuilder';
import PullRequestService, { type GhRunner } from '../src/core/publish/PullRequestService';
import type {
    LockSourceMeta,
    ResolvedSource,
} from '../src/core/types';

describe('PublishResultBuilder', () => {
    test('builds base and completed publish results', () => {
        const builder = new PublishResultBuilder();

        expect(builder.buildBase({
            source: 'upstream',
            dryRun: true,
            changedFiles: [{ status: 'M', path: '.agents/skills/alpha/SKILL.md' }],
            warnings: ['warn'],
            newSkills: ['Alpha'],
            removeSkills: ['Old'],
            createPr: false,
            message: 'Dry-run completed.',
        })).toEqual({
            ok: true,
            source: 'upstream',
            branch: null,
            dryRun: true,
            changedFiles: [{ status: 'M', path: '.agents/skills/alpha/SKILL.md' }],
            warnings: ['warn'],
            newSkills: ['Alpha'],
            removeSkills: ['Old'],
            createPr: false,
            message: 'Dry-run completed.',
        });

        expect(builder.buildCompleted({
            source: 'upstream',
            branch: 'publish/test',
            baseBranch: 'main',
            dryRun: false,
            changedFiles: [{ status: 'A', path: '.agents/skills/beta/SKILL.md' }],
            commitSha: 'abc123',
            compareUrl: 'https://github.com/owner/repo/compare/main...publish%2Ftest?expand=1',
            pr: null,
            warnings: [],
            newSkills: ['Beta'],
            removeSkills: [],
            createPr: true,
            message: 'Publish completed.',
        })).toEqual({
            ok: true,
            source: 'upstream',
            branch: 'publish/test',
            baseBranch: 'main',
            dryRun: false,
            changedFiles: [{ status: 'A', path: '.agents/skills/beta/SKILL.md' }],
            commitSha: 'abc123',
            compareUrl: 'https://github.com/owner/repo/compare/main...publish%2Ftest?expand=1',
            pr: null,
            warnings: [],
            newSkills: ['Beta'],
            removeSkills: [],
            createPr: true,
            message: 'Publish completed.',
        });
    });

    test('resolves metadata from lock default branch without creating a PR when disabled', () => {
        const builder = createBuilder();

        expect(builder.resolveMetadata({
            cloneDir: '/tmp/clone',
            lockSource: createLockSource({ defaultBranch: 'release' }),
            sourceInfo: createSourceInfo(),
            branchName: 'publish/test',
            resolvedCommit: 'abc123',
            selectedNewSkills: [],
            selectedRemoveSkills: [],
            effectiveCreatePr: false,
            title: null,
            body: null,
            warnings: ['existing warning'],
        })).toEqual({
            baseBranch: 'release',
            compareUrl: 'https://github.com/owner/repo/compare/release...publish%2Ftest?expand=1',
            pr: null,
            warnings: ['existing warning'],
        });
    });

    test('falls back to origin head branch and appends PR warnings', () => {
        const gitCalls: { cwd: string; args: string[] }[] = [];
        const ghCalls: { args: string[]; cwd: string | null }[] = [];
        const publishGitService = new PublishGitService({
            gitRunner: createGitRunner(gitCalls, { originHeadStdout: 'origin/trunk\n' }),
        });
        const pullRequestService = new PullRequestService({
            ghRunner: createGhRunner(ghCalls, { authOk: false }),
            publishGitService,
        });
        const builder = new PublishResultBuilder({
            publishGitService,
            pullRequestService,
        });

        expect(builder.resolveMetadata({
            cloneDir: '/tmp/clone',
            lockSource: createLockSource({ defaultBranch: null }),
            sourceInfo: createSourceInfo(),
            branchName: 'publish/test',
            resolvedCommit: 'abc123',
            selectedNewSkills: ['Alpha'],
            selectedRemoveSkills: ['Old'],
            effectiveCreatePr: true,
            title: null,
            body: null,
            warnings: ['existing warning'],
        })).toEqual({
            baseBranch: 'trunk',
            compareUrl: 'https://github.com/owner/repo/compare/trunk...publish%2Ftest?expand=1',
            pr: null,
            warnings: [
                'existing warning',
                'gh CLI is not available or not authenticated; PR was not created automatically.',
            ],
        });
        expect(gitCalls).toEqual([{
            cwd: '/tmp/clone',
            args: ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
        }]);
        expect(ghCalls).toEqual([{ args: ['auth', 'status'], cwd: null }]);
    });
});

function createBuilder(): PublishResultBuilder {
    const publishGitService = new PublishGitService({
        gitRunner: createGitRunner([], {}),
    });
    return new PublishResultBuilder({
        publishGitService,
        pullRequestService: new PullRequestService({
            ghRunner: createGhRunner([], {}),
            publishGitService,
        }),
    });
}

function createGitRunner(
    calls: { cwd: string; args: string[] }[],
    { originHeadStdout = '' }: { originHeadStdout?: string },
): PublishGitRunner {
    return (cwd: string, args: string[]) => {
        calls.push({ cwd, args });
        if (args.join(' ') === 'symbolic-ref refs/remotes/origin/HEAD --short') {
            return {
                ok: Boolean(originHeadStdout),
                status: originHeadStdout ? 0 : 1,
                stdout: originHeadStdout,
                stderr: '',
            };
        }
        return {
            ok: false,
            status: 1,
            stdout: '',
            stderr: `Unexpected git command: ${args.join(' ')}`,
        };
    };
}

function createGhRunner(
    calls: { args: string[]; cwd: string | null }[],
    { authOk = true }: { authOk?: boolean },
): GhRunner {
    return (args, options = {}) => {
        calls.push({ args, cwd: options.cwd ?? null });
        if (args.join(' ') === 'auth status') {
            return {
                status: authOk ? 0 : 1,
                stdout: '',
                stderr: '',
            };
        }
        return {
            status: 1,
            stdout: '',
            stderr: `Unexpected gh command: ${args.join(' ')}`,
        };
    };
}

function createLockSource({ defaultBranch }: { defaultBranch: string | null }): LockSourceMeta {
    return {
        mode: 'all',
        listedAt: '2026-06-05T00:00:00.000Z',
        skillEntries: [],
        sharedFileHashes: [],
        resolved: {
            requestedRef: null,
            defaultBranch,
            resolvedRef: defaultBranch,
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
