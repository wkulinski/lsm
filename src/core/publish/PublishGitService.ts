import GitRunner, { type GitCommandResult } from '../git/GitRunner';
import type { PublishErrorResult } from './PublishParameterResolver';

export type PublishGitResult = GitCommandResult;

export type PublishGitRunner = (cwd: string, args: string[]) => PublishGitResult;

export default class PublishGitService {
    private readonly gitRunner: PublishGitRunner;

    public constructor({ gitRunner = defaultGitRunner }: { gitRunner?: PublishGitRunner } = {}) {
        this.gitRunner = gitRunner;
    }

    public commitAndPushPublishChanges({
        cloneDir, branchName, message,
    }: {
        cloneDir: string;
        branchName: string;
        message?: string | null;
    }): { ok: true; commitSha: string | null } | PublishErrorResult {
        const commitMessage = message && message.trim().length > 0
            ? message
            : 'chore(skills): publish managed skills';
        const commitResult = this.git(cloneDir, ['commit', '-m', commitMessage]);
        if (!commitResult.ok) {
            return {
                ok: false,
                error: 'Failed to create publish commit.',
                details: commitResult.stderr || commitResult.stdout,
            };
        }

        const commitShaResult = this.git(cloneDir, ['rev-parse', 'HEAD']);
        const commitSha = commitShaResult.ok ? commitShaResult.stdout.trim() : null;

        const pushResult = this.git(cloneDir, ['push', '-u', 'origin', branchName]);
        if (!pushResult.ok) {
            return {
                ok: false,
                error: 'Failed to push publish branch.',
                details: pushResult.stderr || pushResult.stdout,
            };
        }

        return { ok: true, commitSha };
    }

    public detectOriginHeadBranch(cwd: string): string | null {
        const result = this.git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short']);
        if (!result.ok) {
            return null;
        }

        const value = result.stdout.trim();
        if (!value) {
            return null;
        }

        return value.replace(/^origin\//, '');
    }

    public buildCompareUrl(webUrl: string | null | undefined, baseBranch: string, branchName: string): string | null {
        if (!webUrl) {
            return null;
        }

        return `${webUrl}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branchName)}?expand=1`;
    }

    public git(cwd: string, args: string[]): PublishGitResult {
        return this.gitRunner(cwd, args);
    }
}

function defaultGitRunner(cwd: string, args: string[]): PublishGitResult {
    return new GitRunner().run(cwd, args);
}
