import path from 'node:path';

import SkillDiscovery from '../source/SkillDiscovery';
import type {
    BackendLike,
    LocalSkill,
    LockData,
    LockSourceMeta,
    ManifestData,
    ResolvedSource,
} from '../types';
import type { PublishErrorResult, ResolvedTargetSourceSuccess } from './PublishParameterResolver';
import PublishPathMapper from './PublishPathMapper';
import PublishPlanBuilder, {
    type PublishPlan,
    type PublishPlanBuilderManifestStore,
} from './PublishPlanBuilder';
import PublishResultBuilder, { type BasePublishResult } from './PublishResultBuilder';

export interface ReadLockSourceSuccess {
    ok: true;
    lockSource: LockSourceMeta;
    resolvedCommit: string;
}

export interface ResolvePrimaryLocalSkillDirSuccess {
    ok: true;
    skillDir: string;
}

export interface PreparePublishContextSuccess {
    ok: true;
    context: {
        targetSource: string;
        lockSource: LockSourceMeta;
        resolvedCommit: string;
        plan: PublishPlan;
        sourceInfo: ResolvedSource;
    };
    result?: never;
}

export interface PreparePublishContextNoop {
    ok: true;
    result: BasePublishResult;
    context?: never;
}

export type LocalSkillDiscoverer = (localSkillDir: string) => Map<string, LocalSkill>;

export default class PublishContextResolver {
    private readonly backend: BackendLike;
    private readonly manifestStore: PublishPlanBuilderManifestStore;
    private readonly resultBuilder: PublishResultBuilder;
    private readonly pathMapper: PublishPathMapper;
    private readonly localSkillDiscoverer: LocalSkillDiscoverer;

    public constructor({
        backend,
        manifestStore,
        resultBuilder = new PublishResultBuilder(),
        pathMapper = new PublishPathMapper(),
        localSkillDiscoverer = null,
    }: {
        backend: BackendLike;
        manifestStore: PublishPlanBuilderManifestStore;
        resultBuilder?: PublishResultBuilder;
        pathMapper?: PublishPathMapper;
        localSkillDiscoverer?: LocalSkillDiscoverer | null;
    }) {
        this.backend = backend;
        this.manifestStore = manifestStore;
        this.resultBuilder = resultBuilder;
        this.pathMapper = pathMapper;
        this.localSkillDiscoverer = localSkillDiscoverer ?? this.discoverLocalSkillsWithSkillDiscovery.bind(this);
    }

    public prepare({
        manifest,
        lock,
        targetSource,
        selectedNewSkills,
        selectedRemoveSkills,
        effectiveCreatePr,
        dryRun,
        confirmDeletes,
    }: {
        manifest: ManifestData;
        lock: LockData;
        targetSource: ResolvedTargetSourceSuccess;
        selectedNewSkills: string[];
        selectedRemoveSkills: string[];
        effectiveCreatePr: boolean;
        dryRun: boolean;
        confirmDeletes: boolean;
    }): PreparePublishContextSuccess | PreparePublishContextNoop | PublishErrorResult {
        const lockSourceResult = this.readLockSource(lock, targetSource.source);
        if (!lockSourceResult.ok) {
            return lockSourceResult;
        }

        const localSkillDirResult = this.resolvePrimaryLocalSkillDir(manifest);
        if (!localSkillDirResult.ok) {
            return localSkillDirResult;
        }

        const localSkills = this.discoverLocalSkills(localSkillDirResult.skillDir);
        const plan = this.buildPublishPlan({
            localSkills,
            lock,
            lockSource: lockSourceResult.lockSource,
            targetSource: targetSource.source,
            newSkills: selectedNewSkills,
            removeSkills: selectedRemoveSkills,
        });
        if (plan.errors.length > 0) {
            return {
                ok: false,
                error: 'Invalid publish selection.',
                details: plan.errors.join('\n'),
            };
        }
        if (plan.deleteItems.length > 0 && !dryRun && !confirmDeletes) {
            return {
                ok: false,
                error: 'Delete operations were planned but --confirm-deletes was not provided.',
                details: this.formatDeleteItems(plan.deleteItems),
            };
        }
        if (plan.items.length === 0) {
            return {
                ok: true,
                result: this.resultBuilder.buildBase({
                    source: targetSource.source,
                    dryRun,
                    changedFiles: [],
                    warnings: plan.warnings,
                    newSkills: selectedNewSkills,
                    removeSkills: selectedRemoveSkills,
                    createPr: effectiveCreatePr,
                    message: 'No publishable changes found.',
                }),
            };
        }

        const sourceInfo = this.backend.resolveSource(targetSource.source);
        if (!sourceInfo.ok) {
            return {
                ok: false,
                error: sourceInfo.error,
            };
        }

        return {
            ok: true,
            context: {
                targetSource: targetSource.source,
                lockSource: lockSourceResult.lockSource,
                resolvedCommit: lockSourceResult.resolvedCommit,
                plan,
                sourceInfo,
            },
        };
    }

    public readLockSource(lock: LockData, sourceName: string): ReadLockSourceSuccess | PublishErrorResult {
        if (!Object.hasOwn(lock.sources, sourceName)) {
            return {
                ok: false,
                error: `Source "${sourceName}" is missing in skills.lock.json. Run sync first.`,
            };
        }
        const lockSource = lock.sources[sourceName];

        const resolvedCommit = lockSource.resolved.resolvedCommit;
        if (!resolvedCommit) {
            return {
                ok: false,
                error: `Missing resolved commit for "${sourceName}" in lock. Run sync first.`,
            };
        }

        return { ok: true, lockSource, resolvedCommit };
    }

    public resolvePrimaryLocalSkillDir(manifest: ManifestData): ResolvePrimaryLocalSkillDirSuccess | PublishErrorResult {
        const resolvedDirs = this.backend.resolveAgentProjectSkillDirs(manifest.agents);
        if (!resolvedDirs.ok) {
            return { ok: false, error: resolvedDirs.error };
        }
        const dirs = resolvedDirs.dirs;

        if (!dirs.length) {
            return {
                ok: false,
                error: 'Could not resolve local skill directory for configured agents.',
            };
        }

        return { ok: true, skillDir: dirs[0] };
    }

    public discoverLocalSkills(localSkillDir: string): Map<string, LocalSkill> {
        return this.localSkillDiscoverer(localSkillDir);
    }

    public buildPublishPlan({
        localSkills, lock, lockSource, targetSource, newSkills, removeSkills,
    }: {
        localSkills: Map<string, LocalSkill>;
        lock: LockData;
        lockSource: LockSourceMeta;
        targetSource: string;
        newSkills: string[];
        removeSkills: string[];
    }): PublishPlan {
        return new PublishPlanBuilder({
            projectRoot: this.backend.root,
            manifestStore: this.manifestStore,
        }).build({
            localSkills,
            lock,
            lockSource,
            targetSource,
            newSkills,
            removeSkills,
        });
    }

    public formatDeleteItems(deleteItems: PublishPlan['deleteItems']): string {
        return new PublishPlanBuilder({
            projectRoot: this.backend.root,
            manifestStore: this.manifestStore,
        }).formatDeleteItems(deleteItems);
    }

    private discoverLocalSkillsWithSkillDiscovery(localSkillDir: string): Map<string, LocalSkill> {
        const discovery = new SkillDiscovery({ includeInternal: true, fullDepth: true });
        const localSkillDirRelative = this.pathMapper.normalizePosix(path.relative(this.backend.root, localSkillDir));
        const discovered = discovery.discover(this.backend.root, localSkillDirRelative);
        const byAlias = new Map<string, LocalSkill>();

        discovered.skills.forEach((skill) => {
            const skillName = skill.name.toLowerCase();
            if (byAlias.has(skillName)) {
                return;
            }
            const localSkill = {
                name: skill.name,
                path: skill.path,
                dirName: path.basename(skill.path),
                sourcePath: this.pathMapper.normalizePosix(path.relative(this.backend.root, skill.path)),
                sharedFiles: Array.isArray(skill.sharedFiles) ? skill.sharedFiles : [],
            };
            byAlias.set(skillName, localSkill);

            const dirNameAlias = localSkill.dirName.toLowerCase();
            if (!byAlias.has(dirNameAlias)) {
                byAlias.set(dirNameAlias, localSkill);
            }
        });

        return byAlias;
    }
}
