import GitSourceClient from './GitSourceClient';
import SkillCatalogBuilder from './SkillCatalogBuilder';
import SkillFrontmatterParser from './SkillFrontmatterParser';
import SkillScanner, { type DiscoveredSkills } from './SkillScanner';
import SharedFileCollector from './SharedFileCollector';
import SourceResolver from './SourceResolver';
import SourceWorkspace, { type SourceWorkspaceHandle } from './SourceWorkspace';
import type {
    CollectSharedFilesSuccess,
    CollectSkillDirectoriesSuccess,
    FailureResult,
    ListSkillsSuccess,
    ResolvedSource,
    ResolveSourceFailure,
} from '../types/discovery';

export default class SkillDiscovery {
    public sourceResolver: SourceResolver;
    public skillCatalogBuilder: SkillCatalogBuilder;
    public skillFrontmatterParser: SkillFrontmatterParser;
    public skillScanner: SkillScanner;
    public sharedFileCollector: SharedFileCollector;
    public gitSourceClient: Pick<GitSourceClient, 'cloneRepo' | 'detectDefaultBranch' | 'gitCapture' | 'cleanupTempDir'>;

    public constructor({ includeInternal = false, fullDepth = false }: { includeInternal?: boolean; fullDepth?: boolean } = {}) {
        const skipDirs = new Set([
            'node_modules',
            '.git',
            'dist',
            'build',
        ]);
        this.sourceResolver = new SourceResolver();
        this.skillCatalogBuilder = new SkillCatalogBuilder();
        this.skillFrontmatterParser = new SkillFrontmatterParser({ includeInternal });
        this.skillScanner = new SkillScanner({
            fullDepth,
            skipDirs,
            skillFrontmatterParser: this.skillFrontmatterParser,
        });
        this.sharedFileCollector = new SharedFileCollector();
        this.gitSourceClient = new GitSourceClient();
    }

    public resolveSource(source: string): ResolvedSource | ResolveSourceFailure {
        return this.sourceResolver.resolve(source);
    }

    public listSkills(source: string, options: { resolvedCommit?: string | null } = {}): ListSkillsSuccess | FailureResult {
        return this.createWorkspace().withWorkspace(
            source,
            { resolvedCommit: options.resolvedCommit ?? null },
            workspace => this.listSkillsInWorkspace(source, workspace),
        );
    }

    public collectSharedFiles(source: string, sharedFiles: string[], options: { resolvedCommit?: string | null } = {}): CollectSharedFilesSuccess | FailureResult {
        return this.createWorkspace().withWorkspace(
            source,
            { resolvedCommit: options.resolvedCommit ?? null, detectDefaultBranch: false },
            workspace => this.sharedFileCollector.collectSharedFiles(workspace.root, sharedFiles),
        );
    }

    public collectSkillDirectories(source: string, skillSourcePaths: string[], options: { resolvedCommit?: string | null } = {}): CollectSkillDirectoriesSuccess | FailureResult {
        return this.createWorkspace().withWorkspace(
            source,
            { resolvedCommit: options.resolvedCommit ?? null, detectDefaultBranch: false },
            workspace => this.sharedFileCollector.collectSkillDirectories(workspace.root, skillSourcePaths),
        );
    }

    public listSkillsInWorkspace(source: string, workspace: SourceWorkspaceHandle): ListSkillsSuccess | FailureResult {
        const { skills, aliasMap } = this.discoverWorkspace(workspace);
        if (skills.length === 0) {
            return {
                ok: false,
                error: `No skills found in ${source}`,
            };
        }

        const catalog = this.skillCatalogBuilder.build(workspace.root, skills);
        const resolvedRef = workspace.resolved.ref
            ?? ((workspace.currentBranch && workspace.currentBranch !== 'HEAD')
                ? workspace.currentBranch
                : (workspace.defaultBranch ?? null));

        return {
            ok: true,
            skills: catalog.skillNames,
            skillEntries: catalog.skillEntries,
            sharedFileHashes: catalog.sharedFileHashes,
            managedSharedFileHashes: catalog.managedSharedFileHashes,
            aliasMap,
            resolved: {
                requestedRef: workspace.resolved.ref ?? null,
                defaultBranch: workspace.defaultBranch,
                resolvedRef,
                resolvedCommit: workspace.resolvedCommit,
                subpath: workspace.resolved.subpath ?? null,
                resolvedAt: new Date().toISOString(),
            },
        };
    }

    public discoverWorkspace(workspace: SourceWorkspaceHandle): DiscoveredSkills {
        return this.discover(workspace.root, workspace.resolved.subpath);
    }

    public discover(basePath: string, subpath: string | null): DiscoveredSkills {
        return this.skillScanner.discover(basePath, subpath);
    }

    public createWorkspace(): SourceWorkspace {
        return new SourceWorkspace({
            resolveSource: source => this.resolveSource(source),
            gitSourceClient: this.gitSourceClient,
        });
    }
}
