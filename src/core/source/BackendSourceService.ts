import SkillDiscovery from './SkillDiscovery';
import PluginDiscovery from './PluginDiscovery';
import SubagentDiscovery from './SubagentDiscovery';
import type { SubagentEntry } from '../types/manifest';
import type {
    CollectSharedFilesSuccess,
    FailureResult,
    ListSkillsSuccess,
    ResolvedSource,
    SourceDiscoverySuccess,
} from '../types/discovery';

export interface BackendSourceListSkillsOptions {
    includeInternal?: boolean;
    fullDepth?: boolean;
    resolvedCommit?: string | null;
}

export type BackendSourceDiscovery = Pick<SkillDiscovery, 'listSkills' | 'resolveSource' | 'collectSharedFiles'> & Partial<Pick<SkillDiscovery, 'createWorkspace' | 'listSkillsInWorkspace'>>;
type SkillDiscoveryFactory = (options?: BackendSourceListSkillsOptions) => BackendSourceDiscovery;

export default class BackendSourceService {
    private readonly createDiscovery: SkillDiscoveryFactory;

    public constructor({
        createDiscovery = (options?: BackendSourceListSkillsOptions): BackendSourceDiscovery => new SkillDiscovery(options),
    }: { createDiscovery?: SkillDiscoveryFactory } = {}) {
        this.createDiscovery = createDiscovery;
    }

    public listSkills(source: string, options: BackendSourceListSkillsOptions = {}): ListSkillsSuccess | FailureResult {
        const discovery = this.createDiscovery({
            includeInternal: options.includeInternal ?? false,
            fullDepth: options.fullDepth ?? false,
        });
        return discovery.listSkills(source, { resolvedCommit: options.resolvedCommit ?? null });
    }

    public resolveSource(source: string): ResolvedSource | FailureResult {
        return this.createDiscovery().resolveSource(source);
    }

    public collectSharedFiles(source: string, sharedFiles: string[], options: { resolvedCommit?: string | null } = {}): CollectSharedFilesSuccess | FailureResult {
        return this.createDiscovery().collectSharedFiles(source, sharedFiles, options);
    }

    public discoverSource(
        source: string,
        {
            skills = null,
            subagents = null,
            includePlugins = false,
            mode = 'update',
            resolvedCommit = null,
            lockedSubagentEntries = [],
            projectRoot,
        }: {
            skills?: string[] | null;
            subagents?: string[] | null;
            includePlugins?: boolean;
            mode?: 'update' | 'locked';
            resolvedCommit?: string | null;
            lockedSubagentEntries?: SubagentEntry[];
            projectRoot?: string;
        } = {},
    ): SourceDiscoverySuccess | FailureResult {
        const discovery = this.createDiscovery({ includeInternal: Boolean(skills?.length) });
        if (!discovery.createWorkspace || !discovery.listSkillsInWorkspace) {
            return { ok: false, error: 'Combined source discovery is not available.' };
        }

        return discovery.createWorkspace().withWorkspace(
            source,
            { resolvedCommit, detectDefaultBranch: true },
            (workspace) => {
                const listedSkills = discovery.listSkillsInWorkspace?.(source, workspace);
                const skillResult = listedSkills?.ok
                    ? listedSkills
                    : {
                        ok: true as const,
                        skills: [],
                        skillEntries: [],
                        sharedFileHashes: [],
                        managedSharedFileHashes: [],
                        aliasMap: new Map<string, string>(),
                        resolved: {
                            requestedRef: workspace.resolved.ref ?? null,
                            defaultBranch: workspace.defaultBranch,
                            resolvedRef: workspace.resolved.ref ?? workspace.currentBranch ?? workspace.defaultBranch,
                            resolvedCommit: workspace.resolvedCommit,
                            subpath: workspace.resolved.subpath ?? null,
                            resolvedAt: new Date().toISOString(),
                        },
                    };
                if (!listedSkills?.ok && (skills?.length ?? 0) > 0) {
                    return listedSkills;
                }

                const subagentResult = new SubagentDiscovery().discoverWorkspace(workspace, {
                    selected: subagents,
                    projectRoot,
                    mode,
                    lockedEntries: lockedSubagentEntries,
                });
                if (!subagentResult.ok) {
                    return subagentResult;
                }
                const pluginResult = includePlugins
                    ? new PluginDiscovery().discoverWorkspace(workspace)
                    : { ok: true as const, plugins: [] };
                if (!pluginResult.ok) {
                    return pluginResult;
                }

                return {
                    ...skillResult,
                    listedAt: new Date().toISOString(),
                    subagents: subagentResult.subagents,
                    subagentSharedFiles: subagentResult.sharedFiles,
                    plugins: pluginResult.plugins,
                };
            },
        ) as SourceDiscoverySuccess | FailureResult;
    }
}
