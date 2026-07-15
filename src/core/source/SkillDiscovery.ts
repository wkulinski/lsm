import GitSourceClient from './GitSourceClient';
import SkillCatalogBuilder from './SkillCatalogBuilder';
import SkillFrontmatterParser from './SkillFrontmatterParser';
import SkillScanner, { type DiscoveredSkills } from './SkillScanner';
import SharedFileCollector from './SharedFileCollector';
import SourceResolver from './SourceResolver';
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
    public gitSourceClient: GitSourceClient;

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

    public listSkills(source: string): ListSkillsSuccess | FailureResult {
        const resolved = this.resolveSource(source);
        if (!resolved.ok) {
            return { ok: false, error: resolved.error };
        }

        const defaultBranch = this.gitSourceClient.detectDefaultBranch(resolved.url);
        const clone = this.gitSourceClient.cloneRepo({ url: resolved.url, ref: resolved.ref, depth: 1 });
        if (!clone.ok) {
            return { ok: false, error: clone.error, details: clone.details };
        }

        try {
            const { skills, aliasMap } = this.discover(clone.dir, resolved.subpath);
            if (skills.length === 0) {
                return {
                    ok: false,
                    error: `No skills found in ${source}`,
                };
            }

            const catalog = this.skillCatalogBuilder.build(clone.dir, skills);

            const resolvedCommitResult = this.gitSourceClient.gitCapture(clone.dir, ['rev-parse', 'HEAD']);
            const resolvedCommit = resolvedCommitResult.ok ? resolvedCommitResult.stdout.trim() : null;
            const currentBranchResult = this.gitSourceClient.gitCapture(clone.dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
            const currentBranch = currentBranchResult.ok ? currentBranchResult.stdout.trim() : null;
            const resolvedRef = resolved.ref
                ?? ((currentBranch && currentBranch !== 'HEAD') ? currentBranch : (defaultBranch ?? null));

            return {
                ok: true,
                skills: catalog.skillNames,
                skillEntries: catalog.skillEntries,
                sharedFileHashes: catalog.sharedFileHashes,
                aliasMap,
                resolved: {
                    requestedRef: resolved.ref ?? null,
                    defaultBranch,
                    resolvedRef,
                    resolvedCommit,
                    subpath: resolved.subpath ?? null,
                    resolvedAt: new Date().toISOString(),
                },
            };
        }
        finally {
            this.gitSourceClient.cleanupTempDir(clone.dir);
        }
    }

    public collectSharedFiles(source: string, sharedFiles: string[]): CollectSharedFilesSuccess | FailureResult {
        const resolved = this.resolveSource(source);
        if (!resolved.ok) {
            return { ok: false, error: resolved.error };
        }

        const clone = this.gitSourceClient.cloneRepo({ url: resolved.url, ref: resolved.ref, depth: 1 });
        if (!clone.ok) {
            return { ok: false, error: clone.error, details: clone.details };
        }

        try {
            return this.sharedFileCollector.collectSharedFiles(clone.dir, sharedFiles);
        }
        finally {
            this.gitSourceClient.cleanupTempDir(clone.dir);
        }
    }

    public collectSkillDirectories(source: string, skillSourcePaths: string[]): CollectSkillDirectoriesSuccess | FailureResult {
        const resolved = this.resolveSource(source);
        if (!resolved.ok) {
            return { ok: false, error: resolved.error };
        }

        const clone = this.gitSourceClient.cloneRepo({ url: resolved.url, ref: resolved.ref, depth: 1 });
        if (!clone.ok) {
            return { ok: false, error: clone.error, details: clone.details };
        }

        try {
            return this.sharedFileCollector.collectSkillDirectories(clone.dir, skillSourcePaths);
        }
        finally {
            this.gitSourceClient.cleanupTempDir(clone.dir);
        }
    }

    public discover(basePath: string, subpath: string | null): DiscoveredSkills {
        return this.skillScanner.discover(basePath, subpath);
    }
}
