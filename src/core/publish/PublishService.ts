import type {
    BackendLike,
    LockData,
    LockSourceMeta,
    ManifestData,
    ManifestPublishConfig,
    ResolvedSource,
} from '../types';
import PublishContextResolver from './PublishContextResolver';
import PublishGitService from './PublishGitService';
import PublishParameterResolver, {
    type PublishErrorResult,
} from './PublishParameterResolver';
import type {
    PublishPlan,
    PublishPlanBuilderManifestStore,
} from './PublishPlanBuilder';
import PublishResultBuilder, {
    type BasePublishResult,
    type CompletedPublishResult,
    type PublishMetadata,
} from './PublishResultBuilder';
import PublishWorkspace, {
    type PrepareWorkspaceSuccess,
    type StagePublishPlanResult,
} from './PublishWorkspace';

interface PublishParameterResolverLike {
    resolve(input: {
        manifest: ManifestData;
        source?: string | null;
        newSkills: string[];
        removeSkills: string[];
        createPr: boolean | null;
    }): ReturnType<PublishParameterResolver['resolve']>;
}

interface PublishContextResolverLike {
    prepare(input: Parameters<PublishContextResolver['prepare']>[0]): ReturnType<PublishContextResolver['prepare']>;
}

interface PublishWorkspaceLike {
    preparePublishWorkspace(input: Parameters<PublishWorkspace['preparePublishWorkspace']>[0]): PrepareWorkspaceSuccess | PublishErrorResult;
    stagePublishPlan(input: Parameters<PublishWorkspace['stagePublishPlan']>[0]): StagePublishPlanResult;
    cleanupTempDir(dir: string | null | undefined): void;
}

interface PublishGitServiceLike {
    commitAndPushPublishChanges(input: Parameters<PublishGitService['commitAndPushPublishChanges']>[0]): ReturnType<PublishGitService['commitAndPushPublishChanges']>;
}

interface PublishResultBuilderLike {
    buildBase(input: Parameters<PublishResultBuilder['buildBase']>[0]): BasePublishResult;
    buildCompleted(input: Parameters<PublishResultBuilder['buildCompleted']>[0]): CompletedPublishResult;
    resolveMetadata(input: Parameters<PublishResultBuilder['resolveMetadata']>[0]): PublishMetadata;
}

export type PublishServiceResult = BasePublishResult | CompletedPublishResult | PublishErrorResult;

export interface PublishServiceInput {
    manifest: ManifestData;
    lock: LockData;
    source?: string | null;
    newSkills?: string[];
    removeSkills?: string[];
    dryRun?: boolean;
    confirmDeletes?: boolean;
    message?: string | null;
    branch?: string | null;
    createPr?: boolean | null;
    title?: string | null;
    body?: string | null;
}

export interface ExecutePublishInput {
    targetSource: string;
    lockSource: LockSourceMeta;
    resolvedCommit: string;
    plan: PublishPlan;
    sourceInfo: ResolvedSource;
    publishConfig: ManifestPublishConfig;
    selectedNewSkills: string[];
    selectedRemoveSkills: string[];
    effectiveCreatePr: boolean;
    dryRun: boolean;
    message: string | null;
    branch: string | null;
    title: string | null;
    body: string | null;
}

export default class PublishService {
    private readonly parameterResolver: PublishParameterResolverLike;
    private readonly contextResolver: PublishContextResolverLike;
    private readonly workspace: PublishWorkspaceLike;
    private readonly gitService: PublishGitServiceLike;
    private readonly resultBuilder: PublishResultBuilderLike;

    public constructor({
        backend,
        manifestStore,
        parameterResolver = new PublishParameterResolver(),
        contextResolver = new PublishContextResolver({ backend, manifestStore }),
        workspace = new PublishWorkspace(),
        gitService = new PublishGitService(),
        resultBuilder = new PublishResultBuilder(),
    }: {
        backend: BackendLike;
        manifestStore: PublishPlanBuilderManifestStore;
        parameterResolver?: PublishParameterResolverLike;
        contextResolver?: PublishContextResolverLike;
        workspace?: PublishWorkspaceLike;
        gitService?: PublishGitServiceLike;
        resultBuilder?: PublishResultBuilderLike;
    }) {
        this.parameterResolver = parameterResolver;
        this.contextResolver = contextResolver;
        this.workspace = workspace;
        this.gitService = gitService;
        this.resultBuilder = resultBuilder;
    }

    public publish({
        manifest,
        lock,
        source,
        newSkills = [],
        removeSkills = [],
        dryRun = false,
        confirmDeletes = false,
        message = null,
        branch = null,
        createPr = null,
        title = null,
        body = null,
    }: PublishServiceInput): PublishServiceResult {
        const resolved = this.parameterResolver.resolve({
            manifest,
            source,
            newSkills,
            removeSkills,
            createPr,
        });
        if (!resolved.ok) {
            return resolved;
        }

        const prepared = this.contextResolver.prepare({
            manifest,
            lock,
            targetSource: resolved.targetSource,
            selectedNewSkills: resolved.selectedNewSkills,
            selectedRemoveSkills: resolved.selectedRemoveSkills,
            effectiveCreatePr: resolved.effectiveCreatePr,
            dryRun,
            confirmDeletes,
        });
        if (!prepared.ok) {
            return prepared;
        }
        if ('result' in prepared) {
            return prepared.result ?? this.resultBuilder.buildBase({
                source: resolved.targetSource.source,
                dryRun,
                changedFiles: [],
                warnings: [],
                newSkills: resolved.selectedNewSkills,
                removeSkills: resolved.selectedRemoveSkills,
                createPr: resolved.effectiveCreatePr,
                message: 'No publishable changes found.',
            });
        }

        return this.executePublish({
            ...prepared.context,
            branch,
            dryRun,
            message,
            title,
            body,
            selectedNewSkills: resolved.selectedNewSkills,
            selectedRemoveSkills: resolved.selectedRemoveSkills,
            effectiveCreatePr: resolved.effectiveCreatePr,
            publishConfig: resolved.publishConfig,
        });
    }

    public executePublish({
        targetSource,
        lockSource,
        resolvedCommit,
        plan,
        sourceInfo,
        publishConfig,
        selectedNewSkills,
        selectedRemoveSkills,
        effectiveCreatePr,
        dryRun,
        message,
        branch,
        title,
        body,
    }: ExecutePublishInput): PublishServiceResult {
        let cloneDir = null;
        try {
            const workspace = this.workspace.preparePublishWorkspace({
                sourceInfo,
                resolvedCommit,
                branch,
                publishConfig,
            });
            if (!workspace.ok) {
                return workspace;
            }

            cloneDir = workspace.cloneDir;
            const staged = this.workspace.stagePublishPlan({ cloneDir, planItems: plan.items });
            if (!staged.ok) {
                return staged;
            }
            if (staged.result) {
                return this.resultBuilder.buildBase({
                    source: targetSource,
                    branch: workspace.branchName,
                    dryRun,
                    changedFiles: [],
                    warnings: plan.warnings,
                    newSkills: selectedNewSkills,
                    removeSkills: selectedRemoveSkills,
                    createPr: effectiveCreatePr,
                    message: staged.result.message,
                });
            }

            if (dryRun) {
                return this.resultBuilder.buildBase({
                    source: targetSource,
                    branch: workspace.branchName,
                    dryRun: true,
                    changedFiles: staged.changedFiles,
                    warnings: plan.warnings,
                    newSkills: selectedNewSkills,
                    removeSkills: selectedRemoveSkills,
                    createPr: effectiveCreatePr,
                    message: 'Dry-run completed.',
                });
            }

            const commitAndPush = this.gitService.commitAndPushPublishChanges({
                cloneDir,
                branchName: workspace.branchName,
                message,
            });
            if (!commitAndPush.ok) {
                return commitAndPush;
            }

            const metadata = this.resultBuilder.resolveMetadata({
                cloneDir,
                lockSource,
                sourceInfo,
                branchName: workspace.branchName,
                resolvedCommit,
                selectedNewSkills,
                selectedRemoveSkills,
                effectiveCreatePr,
                title,
                body,
                warnings: plan.warnings,
            });

            return this.resultBuilder.buildCompleted({
                source: targetSource,
                branch: workspace.branchName,
                baseBranch: metadata.baseBranch,
                dryRun: false,
                changedFiles: staged.changedFiles,
                commitSha: commitAndPush.commitSha,
                compareUrl: metadata.compareUrl,
                pr: metadata.pr,
                warnings: metadata.warnings,
                newSkills: selectedNewSkills,
                removeSkills: selectedRemoveSkills,
                createPr: effectiveCreatePr,
                message: 'Publish completed.',
            });
        }
        finally {
            if (cloneDir) {
                this.workspace.cleanupTempDir(cloneDir);
            }
        }
    }
}
