import SyncSharedFileCopier from './SyncSharedFileCopier';
import ManagedFileSynchronizer from './ManagedFileSynchronizer';
import SyncPathMapper from './SyncPathMapper';
import type {
    BackendLike,
    DiscoveredSources,
    LockData,
    LockSourceMeta,
    ManifestData,
    SharedSyncError,
    SharedSyncResult,
} from '../types';

export interface SharedFilesManifestStoreLike {
    lockManagedSharedFilesBySource(lockSources: { [key: string]: LockSourceMeta } | undefined): { [key: string]: string[] };
}

export default class SyncSharedFiles {
    public backend: BackendLike;
    public manifestStore: SharedFilesManifestStoreLike;
    public pathMapper: SyncPathMapper;
    public copier: SyncSharedFileCopier;
    public synchronizer: ManagedFileSynchronizer;

    public constructor({ backend, manifestStore }: { backend: BackendLike; manifestStore: SharedFilesManifestStoreLike }) {
        this.backend = backend;
        this.manifestStore = manifestStore;
        this.pathMapper = new SyncPathMapper({ backend });
        this.copier = new SyncSharedFileCopier({ backend });
        this.synchronizer = new ManagedFileSynchronizer({ root: backend.root });
    }

    public syncSharedFilesPhase({ manifest, lock, discovered }: { manifest: ManifestData; lock: LockData; discovered: DiscoveredSources }): SharedSyncResult {
        const managedOldSourcePaths = this.manifestStore.lockManagedSharedFilesBySource(lock.sources);
        const managedOldLocalPaths: { [key: string]: string[] } = {};
        const managedNewLocalPaths: { [key: string]: string[] } = {};
        const sharedFileHashesBySource: SharedSyncResult['sharedFileHashesBySource'] = {};
        const managedFileHashesBySource: NonNullable<SharedSyncResult['managedFileHashesBySource']> = {};
        const sharedStats: SharedSyncResult['sharedStats'] = {};
        const errors: SharedSyncError[] = [];
        const declarations = [] as import('./ManagedFileSynchronizer').ManagedFileDeclaration[];

        const dirsResult = this.backend.resolveAgentProjectSkillDirs(manifest.agents);
        if (!dirsResult.ok) {
            return {
                sharedFailed: true,
                managedNewLocalPaths: {},
                sharedStats: {},
                sharedFileHashesBySource: {},
                managedFileHashesBySource: {},
                errors: [{ message: dirsResult.error }],
            };
        }

        Object.entries(lock.sources).forEach(([source, sourceMeta]) => {
            managedOldLocalPaths[source] = this.pathMapper.mapSourceSharedFilesToLocalPaths({
                sourcePaths: managedOldSourcePaths[source] ?? [],
                sourceMeta,
                agentSkillDirs: dirsResult.dirs,
            });
        });

        Object.entries(discovered).forEach(([source, meta]) => {
            const copyResult = this.copier.collectSourceSharedFiles({
                source,
                skillEntries: meta.skillEntries,
                agentSkillDirs: dirsResult.dirs,
                resolvedCommit: meta.resolved.resolvedCommit,
            });
            managedNewLocalPaths[source] = copyResult.managedLocalPaths;
            sharedFileHashesBySource[source] = copyResult.fileHashes;
            managedFileHashesBySource[source] = copyResult.managedFileHashes;
            sharedStats[source] = copyResult.stats;
            declarations.push(...copyResult.declarations);
            errors.push(...copyResult.errors);
        });

        if (errors.length > 0) {
            return {
                sharedFailed: true,
                managedNewLocalPaths,
                sharedStats,
                sharedFileHashesBySource,
                managedFileHashesBySource,
                errors,
            };
        }

        const allNewPaths = new Set(Object.values(managedNewLocalPaths).flat());
        const stalePaths = Object.entries(managedOldLocalPaths)
            .flatMap(([source, paths]) => {
                const newPaths = Object.hasOwn(managedNewLocalPaths, source) ? managedNewLocalPaths[source] : [];
                return paths.filter(filePath => !newPaths.includes(filePath) && !allNewPaths.has(filePath));
            })
            .sort((a, b) => a.localeCompare(b));
        const planResult = this.synchronizer.plan({ files: declarations, removals: stalePaths });
        if (!planResult.ok) {
            return {
                sharedFailed: true,
                managedNewLocalPaths,
                sharedStats,
                sharedFileHashesBySource,
                managedFileHashesBySource,
                errors: [{
                    message: planResult.error === 'Managed file ownership conflicts detected.'
                        ? 'Shared file ownership conflicts detected.'
                        : planResult.error,
                    details: planResult.details,
                }],
            };
        }

        try {
            this.synchronizer.apply(planResult.plan);
        }
        catch (error) {
            return {
                sharedFailed: true,
                managedNewLocalPaths,
                sharedStats,
                sharedFileHashesBySource,
                managedFileHashesBySource,
                errors: [{
                    message: 'Failed while applying managed shared files.',
                    details: error instanceof Error ? error.message : String(error),
                }],
            };
        }

        return {
            sharedFailed: false,
            managedNewLocalPaths,
            sharedStats,
            sharedFileHashesBySource,
            managedFileHashesBySource,
            removedFiles: planResult.plan.removals.length,
            errors: [],
        };
    }
}
