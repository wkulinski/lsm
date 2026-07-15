import type {
    LockSourceMeta,
    ResolvedSource,
} from '../types';
import PublishGitService from './PublishGitService';
import type { PublishErrorResult } from './PublishParameterResolver';
import PullRequestService, { type PublishPrSuccess } from './PullRequestService';
import type { ChangedFile } from './PublishWorkspace';

export interface BasePublishResult {
    ok: true;
    source: string;
    branch: string | null;
    dryRun: boolean;
    changedFiles: ChangedFile[];
    warnings: string[];
    newSkills: string[];
    removeSkills: string[];
    createPr: boolean;
    message: string;
}

export interface CompletedPublishResult extends BasePublishResult {
    baseBranch: string;
    commitSha: string | null;
    compareUrl: string | null;
    pr: PublishPrSuccess | null;
}

export interface PublishMetadata {
    baseBranch: string;
    compareUrl: string | null;
    pr: PublishPrSuccess | null;
    warnings: string[];
}

export default class PublishResultBuilder {
    private readonly publishGitService: PublishGitService;
    private readonly pullRequestService: PullRequestService;

    public constructor({
        publishGitService = new PublishGitService(),
        pullRequestService = new PullRequestService({ publishGitService }),
    }: {
        publishGitService?: PublishGitService;
        pullRequestService?: PullRequestService;
    } = {}) {
        this.publishGitService = publishGitService;
        this.pullRequestService = pullRequestService;
    }

    public buildBase({
        source,
        branch = null,
        dryRun,
        changedFiles,
        warnings,
        newSkills,
        removeSkills,
        createPr,
        message,
    }: {
        source: string;
        branch?: string | null;
        dryRun: boolean;
        changedFiles: ChangedFile[];
        warnings: string[];
        newSkills: string[];
        removeSkills: string[];
        createPr: boolean;
        message: string;
    }): BasePublishResult {
        return {
            ok: true,
            source,
            branch,
            dryRun,
            changedFiles,
            warnings,
            newSkills,
            removeSkills,
            createPr,
            message,
        };
    }

    public buildCompleted({
        source,
        branch,
        baseBranch,
        dryRun,
        changedFiles,
        commitSha,
        compareUrl,
        pr,
        warnings,
        newSkills,
        removeSkills,
        createPr,
        message,
    }: {
        source: string;
        branch: string;
        baseBranch: string;
        dryRun: boolean;
        changedFiles: ChangedFile[];
        commitSha: string | null;
        compareUrl: string | null;
        pr: PublishPrSuccess | null;
        warnings: string[];
        newSkills: string[];
        removeSkills: string[];
        createPr: boolean;
        message: string;
    }): CompletedPublishResult {
        return {
            ...this.buildBase({
                source,
                branch,
                dryRun,
                changedFiles,
                warnings,
                newSkills,
                removeSkills,
                createPr,
                message,
            }),
            baseBranch,
            commitSha,
            compareUrl,
            pr,
        };
    }

    public resolveMetadata({
        cloneDir,
        lockSource,
        sourceInfo,
        branchName,
        resolvedCommit,
        selectedNewSkills,
        selectedRemoveSkills,
        effectiveCreatePr,
        title,
        body,
        warnings,
    }: {
        cloneDir: string;
        lockSource: LockSourceMeta;
        sourceInfo: ResolvedSource;
        branchName: string;
        resolvedCommit: string;
        selectedNewSkills: string[];
        selectedRemoveSkills: string[];
        effectiveCreatePr: boolean;
        title: string | null;
        body: string | null;
        warnings: string[];
    }): PublishMetadata {
        const baseBranch = lockSource.resolved.defaultBranch
            ?? this.publishGitService.detectOriginHeadBranch(cloneDir)
            ?? 'master';
        const compareUrl = this.publishGitService.buildCompareUrl(sourceInfo.webUrl, baseBranch, branchName);
        const pr = this.pullRequestService.createPublishPr({
            cloneDir,
            sourceInfo,
            baseBranch,
            branchName,
            resolvedCommit,
            selectedNewSkills,
            selectedRemoveSkills,
            effectiveCreatePr,
            title,
            body,
        });

        return {
            baseBranch,
            compareUrl,
            pr: pr.pr,
            warnings: [...warnings, ...pr.warnings],
        };
    }
}

export type PublishResult = BasePublishResult | CompletedPublishResult | PublishErrorResult;
