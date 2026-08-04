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
    SubagentSyncResult,
    SyncSourceReport,
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
    syncSubagentsPhase?(input: { lock: LockData; discovered: DiscoveredSources; force?: boolean }): SubagentSyncResult;
    removePhase(plan: SyncPlan): SyncRemovalSummary;
}

export interface SyncServiceManifestStore {
    writeLock(input: { agents: string[]; subagents?: string[]; sources: { [key: string]: LockSourceMeta } }): void;
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
            if (discovery.missingRequested.length > 0) {
                return {
                    status: 'error',
                    exitCode: 1,
                    error: 'Requested skills were not found in the source; synchronization was not applied.',
                    details: discovery.missingRequested,
                    header: runtime.header,
                };
            }
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

            const addResult = this.runAddPhase({ runtime, discovered: discovery.discovered, report });

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

            const shared = this.runSharedPhase({ runtime, discovered: discovery.discovered, report });

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

            return this.finishSync({
                runtime,
                discovered: discovery.discovered,
                missingRequested: discovery.missingRequested,
                plan,
                preflight,
                installs: addResult.installs,
                shared,
                isUpdate,
                force: options.force === true,
                report,
            });
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

    private finishSync({ runtime, discovered, missingRequested, plan, preflight, installs, shared, isUpdate, force, report }: {
        runtime: SyncServiceRuntime;
        discovered: DiscoveredSources;
        missingRequested: { source: string; skill: string }[];
        plan: SyncPlan;
        preflight: SyncPreflight;
        installs: SyncInstallResult[];
        shared: SharedSyncResult;
        isUpdate: boolean;
        force: boolean;
        report?: SyncServiceReporter;
    }): SyncCommandResult {
        const subagents = this.runSubagentPhase({ runtime, discovered, force, report });
        if (subagents.subagentFailed) {
            return {
                status: 'subagent-failed',
                exitCode: 1,
                header: runtime.header,
                plan,
                preflight,
                installs,
                shared,
                subagents,
            };
        }

        report?.({ type: 'sync-remove-start', plan });
        const removal = runtime.sync.removePhase(plan);
        const shouldFail = missingRequested.length > 0;
        const lockWritten = isUpdate && !shouldFail;
        if (lockWritten) {
            runtime.manifestStore.writeLock({
                agents: runtime.manifest.agents,
                subagents: runtime.manifest.subagents ?? [],
                sources: lockSourcesFromDiscovered(
                    discovered,
                    shared.sharedFileHashesBySource,
                    shared.managedFileHashesBySource,
                ),
            });
        }

        return {
            status: 'completed',
            exitCode: shouldFail ? 1 : 0,
            header: runtime.header,
            plan,
            preflight,
            missingRequested,
            installs,
            shared,
            ...(runtime.manifest.subagents?.length ? { subagents } : {}),
            removal,
            lockWritten,
            lockMode: isUpdate ? 'updated' : 'locked',
        };
    }

    private runAddPhase({ runtime, discovered, report }: {
        runtime: SyncServiceRuntime;
        discovered: DiscoveredSources;
        report?: SyncServiceReporter;
    }): { installs: SyncInstallResult[]; addFailed: boolean } {
        if (runtime.manifest.agents.length === 0) {
            return { installs: [], addFailed: false };
        }

        report?.({ type: 'sync-add-start' });
        Object.entries(discovered).forEach(([source, meta]) => {
            report?.({
                type: 'sync-add-source',
                source,
                mode: meta.mode,
                skillCount: meta.skills.length,
            });
        });
        return runtime.sync.addPhase(discovered, runtime.manifest.agents);
    }

    private runSharedPhase({ runtime, discovered, report }: {
        runtime: SyncServiceRuntime;
        discovered: DiscoveredSources;
        report?: SyncServiceReporter;
    }): SharedSyncResult {
        if (runtime.manifest.agents.length === 0) {
            return this.emptySharedResult();
        }

        report?.({ type: 'sync-shared-start' });
        return runtime.sync.syncSharedFilesPhase({
            manifest: runtime.manifest,
            lock: runtime.lock,
            discovered,
        });
    }

    private runSubagentPhase({ runtime, discovered, force, report }: {
        runtime: SyncServiceRuntime;
        discovered: DiscoveredSources;
        force: boolean;
        report?: SyncServiceReporter;
    }): SubagentSyncResult {
        if ((runtime.manifest.subagents ?? []).length === 0) {
            return this.emptySubagentResult();
        }

        report?.({ type: 'sync-subagents-start' });
        Object.entries(discovered).forEach(([source, meta]) => {
            report?.({
                type: 'sync-subagent-source',
                source,
                mode: meta.subagentMode ?? (meta.subagents?.length ? 'all' : 'none'),
                selected: meta.subagents?.length ?? 0,
            });
        });
        const result = runtime.sync.syncSubagentsPhase?.({ lock: runtime.lock, discovered, force }) ?? {
            subagentFailed: true,
            sources: Object.keys(discovered).length,
            detected: 0,
            installed: 0,
            removed: 0,
            sharedFiles: 0,
            errors: [{ message: 'Subagent synchronization phase is not configured.' }],
        };
        report?.({
            type: 'sync-subagents',
            sources: result.sources ?? Object.keys(discovered).length,
            sourceReports: result.sourceReports ?? this.subagentSourceReports(discovered),
            detected: result.detected,
            installed: result.installed,
            removed: result.removed,
            sharedFiles: result.sharedFiles,
        });
        return result;
    }

    private subagentSourceReports(discovered: DiscoveredSources): SyncSourceReport[] {
        return Object.entries(discovered).map(([source, meta]) => ({
            source,
            mode: meta.subagentMode ?? (meta.subagents?.length ? 'all' : 'none'),
            selected: meta.subagents?.length ?? 0,
            installed: 0,
            removed: 0,
            sharedFiles: 0,
        }));
    }

    private emptySharedResult(): SharedSyncResult {
        return {
            sharedFailed: false,
            managedNewLocalPaths: {},
            sharedStats: {},
            sharedFileHashesBySource: {},
            managedFileHashesBySource: {},
            removedFiles: 0,
            errors: [],
        };
    }

    private emptySubagentResult(): SubagentSyncResult {
        return {
            subagentFailed: false,
            sources: 0,
            detected: 0,
            installed: 0,
            removed: 0,
            sharedFiles: 0,
            errors: [],
        };
    }

    private validateManifestLock(runtime: SyncServiceRuntime, isUpdate: boolean): ManagerErrorResult | null {
        if (isUpdate) {
            return null;
        }

        const error = this.lockValidator.validateManifest({ manifest: runtime.manifest, lock: runtime.lock });
        if (error) {
            return { status: 'error', exitCode: 1, error, header: runtime.header };
        }
        return null;
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
