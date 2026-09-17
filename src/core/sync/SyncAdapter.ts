import SyncDiscoveryConflicts from './SyncDiscoveryConflicts';
import SyncDiscovery from './SyncDiscovery';
import SyncInstallPhase from './SyncInstallPhase';
import SyncPlanner from './SyncPlanner';
import SyncPreflightConflicts from './SyncPreflightConflicts';
import RemovalPhase from './RemovalPhase';
import SyncSharedFiles from './SyncSharedFiles';
import SubagentSyncPhase from './SubagentSyncPhase';
import SubagentManagedFileAdapter from '../subagents/SubagentManagedFileAdapter';
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
    SyncPreflight,
    SubagentSyncResult,
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
        const legacyPreflight: SyncPreflight = manifest.agents.length > 0
            ? new SyncPreflightConflicts({ backend: this.backend }).collectLocalChangeConflicts({ manifest, lock, discovered, plan })
            : { ok: true, conflicts: [] };
        if (!legacyPreflight.ok) {
            return legacyPreflight;
        }

        const conflicts = [...legacyPreflight.conflicts];
        if ((manifest.subagents ?? []).length > 0) {
            const subagentPlan = new SubagentSyncPhase({ root: this.backend.root }).plan({ lock, discovered });
            if (!subagentPlan.ok) {
                conflicts.push({
                    path: 'subagents',
                    reason: subagentPlan.error,
                    operation: 'overwrite',
                    scope: 'subagent',
                    source: null,
                    skill: null,
                });
            }

            const subagentDeclarations = new SubagentManagedFileAdapter();
            Object.entries(discovered).forEach(([subagentSource, meta]) => {
                subagentDeclarations.declarations({
                    source: subagentSource,
                    subagents: meta.subagents ?? [],
                    plugins: meta.plugins ?? [],
                    sharedFiles: meta.subagentSharedFiles ?? [],
                }).filter(declaration => declaration.targetPath.startsWith('.agents/skills/_shared/'))
                    .forEach((declaration) => {
                        Object.entries(discovered).forEach(([skillSource, skillMeta]) => {
                            const sharedPath = (skillMeta.managedSharedFileHashes ?? []).find(entry => entry.path === declaration.targetPath);
                            if (sharedPath && skillSource !== subagentSource) {
                                conflicts.push({
                                    path: declaration.targetPath,
                                    reason: 'managed-file-ownership-conflict',
                                    operation: 'overwrite',
                                    scope: 'shared',
                                    source: skillSource,
                                    skill: null,
                                });
                            }
                        });
                    });
            });
        }

        return { ok: true, conflicts };
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

    public syncSubagentsPhase({ lock, discovered, force = false }: { lock: LockData; discovered: DiscoveredSources; force?: boolean }): SubagentSyncResult {
        return new SubagentSyncPhase({ root: this.backend.root }).synchronize({ lock, discovered, force });
    }
}
