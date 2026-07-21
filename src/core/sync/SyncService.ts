import { lockSourcesFromDiscovered } from '../manifest/lockMappers';
import { normalizeError } from '../shared/errors';
import SyncLockValidator from './SyncLockValidator';
import type {
    DiscoveredSources,
    LockData,
    LockSourceMeta,
    ManagerErrorResult,
    ManagerEvent,
    ManagerHeader,
    ManifestData,
    SharedSyncResult,
    SyncCommandOptions,
    SyncCommandResult,
    SyncInstallResult,
    SyncPlan,
    SyncPreflight,
    SyncPreflightConflict,
    SyncRemovalSummary,
} from '../types';

export type SyncServiceReporter = (event: ManagerEvent) => void;

export interface SyncServiceOperations {
    discover(manifest: ManifestData, options?: { update?: boolean; lock?: LockData }): {
        discovered: DiscoveredSources;
        missingRequested: { source: string; skill: string }[];
    };
    assertNoConflicts(discovered: DiscoveredSources): void;
    planRemovals(input: { lock: LockData; manifest: ManifestData; discovered: DiscoveredSources }): SyncPlan;
    collectLocalChangeConflicts(input: {
        manifest: ManifestData;
        lock: LockData;
        discovered: DiscoveredSources;
        plan?: Partial<SyncPlan>;
    }): { ok: boolean; error?: string; conflicts: SyncPreflightConflict[] };
    addPhase(discovered: DiscoveredSources, agents: string[]): { installs: SyncInstallResult[]; addFailed: boolean };
    syncSharedFilesPhase(input: {
        manifest: ManifestData;
        lock: LockData;
        discovered: DiscoveredSources;
    }): SharedSyncResult;
    removePhase(plan: SyncPlan): SyncRemovalSummary;
}

export interface SyncServiceManifestStore {
    writeLock(input: { agents: string[]; sources: { [key: string]: LockSourceMeta } }): void;
}

export interface SyncServiceRuntime {
    header: ManagerHeader;
    manifest: ManifestData;
    lock: LockData;
    sync: SyncServiceOperations;
    manifestStore: SyncServiceManifestStore;
}

type SyncPreflightFailure = ManagerErrorResult | Extract<SyncCommandResult, { status: 'cancelled' }>;

type SyncPreflightDecision
    = | { ok: true; preflight: SyncPreflight }
        | { ok: false; result: SyncPreflightFailure };

export default class SyncService {
    private readonly lockValidator = new SyncLockValidator();

    public async run(
        {
            runtime,
            options = {},
            report,
        }: {
            runtime: SyncServiceRuntime;
            options?: SyncCommandOptions;
            report?: SyncServiceReporter;
        },
    ): Promise<SyncCommandResult> {
        report?.({ type: 'header', header: runtime.header });

        try {
            const isUpdate = options.update === true;
            const manifestLockError = this.validateManifestLock(runtime, isUpdate);
            if (manifestLockError) {
                return manifestLockError;
            }

            report?.({ type: 'sync-discover-start' });
            const discovery = runtime.sync.discover(runtime.manifest, {
                update: isUpdate,
                lock: runtime.lock,
            });
            runtime.sync.assertNoConflicts(discovery.discovered);

            const discoveredLockError = this.validateDiscoveredLock(runtime, discovery.discovered, isUpdate);
            if (discoveredLockError) {
                return discoveredLockError;
            }

            const plan = runtime.sync.planRemovals({
                lock: runtime.lock,
                manifest: runtime.manifest,
                discovered: discovery.discovered,
            });
            report?.({ type: 'sync-plan', plan });

            const preflightDecision = await this.resolveSyncPreflight({
                runtime,
                discovered: discovery.discovered,
                plan,
                options,
                report,
            });
            if (!preflightDecision.ok) {
                return preflightDecision.result;
            }
            const preflight = preflightDecision.preflight;

            report?.({ type: 'sync-add-start' });
            Object.entries(discovery.discovered).forEach(([source, meta]) => {
                report?.({
                    type: 'sync-add-source',
                    source,
                    mode: meta.mode,
                    skillCount: meta.skills.length,
                });
            });
            const addResult = runtime.sync.addPhase(discovery.discovered, runtime.manifest.agents);

            if (addResult.addFailed) {
                return {
                    status: 'add-failed',
                    exitCode: 1,
                    header: runtime.header,
                    plan,
                    preflight,
                    installs: addResult.installs,
                };
            }

            report?.({ type: 'sync-shared-start' });
            const shared = runtime.sync.syncSharedFilesPhase({
                manifest: runtime.manifest,
                lock: runtime.lock,
                discovered: discovery.discovered,
            });

            if (shared.sharedFailed) {
                return {
                    status: 'shared-failed',
                    exitCode: 1,
                    header: runtime.header,
                    plan,
                    preflight,
                    installs: addResult.installs,
                    shared,
                };
            }

            report?.({ type: 'sync-remove-start', plan });
            const removal = runtime.sync.removePhase(plan);

            const shouldFail = discovery.missingRequested.length > 0;
            const lockWritten = isUpdate && !shouldFail;
            if (lockWritten) {
                runtime.manifestStore.writeLock({
                    agents: runtime.manifest.agents,
                    sources: lockSourcesFromDiscovered(discovery.discovered, shared.sharedFileHashesBySource),
                });
            }

            return {
                status: 'completed',
                exitCode: shouldFail ? 1 : 0,
                header: runtime.header,
                plan,
                preflight,
                missingRequested: discovery.missingRequested,
                installs: addResult.installs,
                shared,
                removal,
                lockWritten,
                lockMode: isUpdate ? 'updated' : 'locked',
            };
        }
        catch (error) {
            const normalized = normalizeError(error);
            return {
                status: 'error',
                exitCode: 1,
                error: normalized.error,
                details: normalized.details,
                header: runtime.header,
            };
        }
    }

    private validateManifestLock(runtime: SyncServiceRuntime, isUpdate: boolean): ManagerErrorResult | null {
        if (isUpdate) {
            return null;
        }

        const error = this.lockValidator.validateManifest({ manifest: runtime.manifest, lock: runtime.lock });
        return error
            ? { status: 'error', exitCode: 1, error, header: runtime.header }
            : null;
    }

    private validateDiscoveredLock(runtime: SyncServiceRuntime, discovered: DiscoveredSources, isUpdate: boolean): ManagerErrorResult | null {
        if (isUpdate) {
            return null;
        }

        const error = this.lockValidator.validateDiscovered({ lock: runtime.lock, discovered });
        return error
            ? { status: 'error', exitCode: 1, error, header: runtime.header }
            : null;
    }

    private async resolveSyncPreflight({
        runtime,
        discovered,
        plan,
        options,
        report,
    }: {
        runtime: SyncServiceRuntime;
        discovered: DiscoveredSources;
        plan: SyncPlan;
        options: SyncCommandOptions;
        report?: SyncServiceReporter;
    }): Promise<SyncPreflightDecision> {
        const preflight = runtime.sync.collectLocalChangeConflicts({
            manifest: runtime.manifest,
            lock: runtime.lock,
            discovered,
            plan,
        }) as SyncPreflight;
        if (!preflight.ok) {
            return {
                ok: false,
                result: {
                    status: 'error',
                    exitCode: 1,
                    error: `Preflight failed: ${preflight.error ?? 'unknown error'}`,
                    header: runtime.header,
                },
            };
        }

        if (preflight.conflicts.length === 0) {
            return { ok: true, preflight };
        }

        report?.({ type: 'sync-preflight', preflight, force: options.force === true });
        if (options.force === true) {
            return { ok: true, preflight };
        }

        if (!options.confirmLocalChanges) {
            return {
                ok: false,
                result: {
                    status: 'error',
                    exitCode: 1,
                    error: 'Local change conflicts detected, but no confirmation handler was provided.',
                    header: runtime.header,
                },
            };
        }

        const confirmed = await options.confirmLocalChanges({
            header: runtime.header,
            preflight,
            plan,
        });
        if (confirmed) {
            return { ok: true, preflight };
        }

        return {
            ok: false,
            result: {
                status: 'cancelled',
                exitCode: 1,
                header: runtime.header,
                plan,
                preflight,
            },
        };
    }
}
