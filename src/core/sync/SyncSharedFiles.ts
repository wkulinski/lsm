import SyncSharedFileCopier from './SyncSharedFileCopier';
import SyncSharedFileOwnership from './SyncSharedFileOwnership';
import SyncSharedFilePruner from './SyncSharedFilePruner';
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
    public ownership: SyncSharedFileOwnership;
    public pruner: SyncSharedFilePruner;

    public constructor({ backend, manifestStore }: { backend: BackendLike; manifestStore: SharedFilesManifestStoreLike }) {
        this.backend = backend;
        this.manifestStore = manifestStore;
        this.pathMapper = new SyncPathMapper({ backend });
        this.copier = new SyncSharedFileCopier({ backend });
        this.ownership = new SyncSharedFileOwnership();
        this.pruner = new SyncSharedFilePruner({ backend });
    }

    public syncSharedFilesPhase({ manifest, lock, discovered }: { manifest: ManifestData; lock: LockData; discovered: DiscoveredSources }): SharedSyncResult {
        const managedOldSourcePaths = this.manifestStore.lockManagedSharedFilesBySource(lock.sources);
        const managedOldLocalPaths: { [key: string]: string[] } = {};
        const managedNewLocalPaths: { [key: string]: string[] } = {};
        const sharedFileHashesBySource: SharedSyncResult['sharedFileHashesBySource'] = {};
        const sharedStats: SharedSyncResult['sharedStats'] = {};
        const errors: SharedSyncError[] = [];

        const dirsResult = this.backend.resolveAgentProjectSkillDirs(manifest.agents);
        if (!dirsResult.ok) {
            return {
                sharedFailed: true,
                managedNewLocalPaths: {},
                sharedStats: {},
                sharedFileHashesBySource: {},
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
            const copyResult = this.copier.copySourceSharedFiles({
                source,
                skillEntries: meta.skillEntries,
                agentSkillDirs: dirsResult.dirs,
                resolvedCommit: meta.resolved.resolvedCommit,
            });
            managedNewLocalPaths[source] = copyResult.managedLocalPaths;
            sharedFileHashesBySource[source] = copyResult.fileHashes;
            sharedStats[source] = copyResult.stats;
            errors.push(...copyResult.errors);
        });

        const conflicts = this.ownership.detectOwnershipConflicts(managedNewLocalPaths);
        if (conflicts.length) {
            return {
                sharedFailed: true,
                managedNewLocalPaths,
                sharedStats,
                sharedFileHashesBySource,
                errors: [{
                    message: 'Shared file ownership conflicts detected.',
                    details: conflicts,
                }],
            };
        }

        if (errors.length > 0) {
            return {
                sharedFailed: true,
                managedNewLocalPaths,
                sharedStats,
                sharedFileHashesBySource,
                errors,
            };
        }

        const removedFiles = this.pruner.pruneStaleManagedFiles(managedOldLocalPaths, managedNewLocalPaths);

        return {
            sharedFailed: false,
            managedNewLocalPaths,
            sharedStats,
            sharedFileHashesBySource,
            removedFiles,
            errors: [],
        };
    }
}
