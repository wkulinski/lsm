import SyncDiscoveryConflicts from './SyncDiscoveryConflicts';
import SyncDiscovery from './SyncDiscovery';
import SyncInstallPhase from './SyncInstallPhase';
import SyncPlanner from './SyncPlanner';
import SyncPreflightConflicts from './SyncPreflightConflicts';
import RemovalPhase from './RemovalPhase';
import SyncSharedFiles from './SyncSharedFiles';
import type {
    BackendLike,
    DiscoveredSources,
    LockData,
    LockSourceMeta,
    ManifestData,
    SharedSyncResult,
    SyncInstallResult,
    SyncPlan,
    SyncPreflightConflict,
    SyncRemovalSummary,
} from '../types';

interface ManifestStoreLike {
    lockManagedSkills(lockSources: { [key: string]: LockSourceMeta } | undefined): string[];
    lockManagedSharedFilesBySource(lockSources: { [key: string]: LockSourceMeta } | undefined): { [key: string]: string[] };
}

export default class SyncAdapter {
    public backend: BackendLike;
    public manifestStore: ManifestStoreLike;

    public constructor({ backend, manifestStore }: { backend: BackendLike; manifestStore: ManifestStoreLike }) {
        this.backend = backend;
        this.manifestStore = manifestStore;
    }

    public discover(manifest: ManifestData, options: { update?: boolean; lock?: LockData } = {}): { discovered: DiscoveredSources; missingRequested: { source: string; skill: string }[] } {
        return new SyncDiscovery({ backend: this.backend }).discover(manifest, options);
    }

    public assertNoConflicts(discovered: DiscoveredSources): void {
        new SyncDiscoveryConflicts().assertNoConflicts(discovered);
    }

    public planRemovals({ lock, manifest, discovered }: { lock: LockData; manifest: ManifestData; discovered: DiscoveredSources }): SyncPlan {
        return new SyncPlanner({ manifestStore: this.manifestStore }).planRemovals({ lock, manifest, discovered });
    }

    public collectLocalChangeConflicts(
        { manifest, lock, discovered, plan }: { manifest: ManifestData; lock: LockData; discovered: DiscoveredSources; plan?: Partial<SyncPlan> },
    ): { ok: boolean; error?: string; conflicts: SyncPreflightConflict[] } {
        return new SyncPreflightConflicts({ backend: this.backend }).collectLocalChangeConflicts({
            manifest,
            lock,
            discovered,
            plan,
        });
    }

    public removePhase(plan: SyncPlan): SyncRemovalSummary {
        return new RemovalPhase({ backend: this.backend }).removePhase(plan);
    }

    public addPhase(discovered: DiscoveredSources, agents: string[]): { installs: SyncInstallResult[]; addFailed: boolean } {
        return new SyncInstallPhase({ backend: this.backend }).addPhase(discovered, agents);
    }

    public syncSharedFilesPhase({ manifest, lock, discovered }: { manifest: ManifestData; lock: LockData; discovered: DiscoveredSources }): SharedSyncResult {
        return new SyncSharedFiles({
            backend: this.backend,
            manifestStore: this.manifestStore,
        }).syncSharedFilesPhase({ manifest, lock, discovered });
    }
}
