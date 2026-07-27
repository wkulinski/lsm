import GitSourceClient, { type CloneRepoFailure } from './GitSourceClient';
import SourceResolver from './SourceResolver';
import type {
    FailureResult,
    ResolvedSource,
    ResolveSourceFailure,
} from '../types/discovery';

export interface SourceWorkspaceHandle {
    source: string;
    root: string;
    resolved: ResolvedSource;
    defaultBranch: string | null;
    resolvedCommit: string | null;
    currentBranch: string | null;
}

export interface SourceWorkspaceOptions {
    resolvedCommit?: string | null;
    depth?: number | null;
    detectDefaultBranch?: boolean;
}

export type SourceResolve = (source: string) => ResolvedSource | ResolveSourceFailure;
export type SourceWorkspaceGitClient = Pick<GitSourceClient, 'cloneRepo' | 'detectDefaultBranch' | 'gitCapture' | 'cleanupTempDir'>;

export default class SourceWorkspace {
    private readonly resolveSource: SourceResolve;
    private readonly gitSourceClient: SourceWorkspaceGitClient;

    public constructor(
        {
            resolveSource = (source: string): ResolvedSource | ResolveSourceFailure => new SourceResolver().resolve(source),
            gitSourceClient = new GitSourceClient(),
        }: {
            resolveSource?: SourceResolve;
            gitSourceClient?: SourceWorkspaceGitClient;
        } = {},
    ) {
        this.resolveSource = resolveSource;
        this.gitSourceClient = gitSourceClient;
    }

    public withWorkspace<T>(
        source: string,
        options: SourceWorkspaceOptions,
        callback: (workspace: SourceWorkspaceHandle) => T,
    ): T | FailureResult {
        const resolved = this.resolveSource(source);
        if (!resolved.ok) {
            return resolved;
        }

        const resolvedCommit = options.resolvedCommit ?? null;
        const defaultBranch = options.detectDefaultBranch === false
            ? null
            : this.gitSourceClient.detectDefaultBranch(resolved.url);
        const clone = this.gitSourceClient.cloneRepo({
            url: resolved.url,
            ref: resolvedCommit ? null : resolved.ref,
            commit: resolvedCommit,
            depth: options.depth ?? 1,
        });
        if (!clone.ok) {
            return this.cloneFailure(clone);
        }

        try {
            const resolvedCommitResult = this.gitSourceClient.gitCapture(clone.dir, ['rev-parse', 'HEAD']);
            const currentBranchResult = this.gitSourceClient.gitCapture(clone.dir, ['rev-parse', '--abbrev-ref', 'HEAD']);

            return callback({
                source,
                root: clone.dir,
                resolved,
                defaultBranch,
                resolvedCommit: resolvedCommitResult.ok ? resolvedCommitResult.stdout.trim() : null,
                currentBranch: currentBranchResult.ok ? currentBranchResult.stdout.trim() : null,
            });
        }
        finally {
            this.gitSourceClient.cleanupTempDir(clone.dir);
        }
    }

    private cloneFailure(clone: CloneRepoFailure): FailureResult {
        return {
            ok: false,
            error: clone.error,
            details: clone.details,
        };
    }
}
