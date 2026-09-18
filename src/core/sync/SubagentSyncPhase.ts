import type { DiscoveredSources, LockData, PluginEntry, SubagentEntry, SubagentSyncResult, SyncPluginSummary, SyncSourceReport } from '../types';
import SubagentManagedFileAdapter from '../subagents/SubagentManagedFileAdapter';
import ManagedFileSynchronizer, { type ManagedFileBaseline, type ManagedFilePlan } from './ManagedFileSynchronizer';

export interface SubagentSyncPlanSuccess {
    ok: true;
    plan: ManagedFilePlan;
    result: SubagentSyncResult;
}

export interface SubagentSyncPlanFailure {
    ok: false;
    error: string;
    details?: unknown;
}

export type SubagentSyncPlanResult = SubagentSyncPlanSuccess | SubagentSyncPlanFailure;

export default class SubagentSyncPhase {
    private readonly synchronizer: ManagedFileSynchronizer;
    private readonly adapter: SubagentManagedFileAdapter;

    public constructor({ root, synchronizer, adapter }: {
        root: string;
        synchronizer?: ManagedFileSynchronizer;
        adapter?: SubagentManagedFileAdapter;
    }) {
        this.synchronizer = synchronizer ?? new ManagedFileSynchronizer({ root });
        this.adapter = adapter ?? new SubagentManagedFileAdapter();
    }

    public plan({ lock, discovered, force = false }: { lock: LockData; discovered: DiscoveredSources; force?: boolean }): SubagentSyncPlanResult {
        const declarations = Object.entries(discovered).flatMap(([source, meta]) => this.adapter.declarations({
            source,
            subagents: meta.subagents ?? [],
            plugins: meta.plugins ?? [],
            sharedFiles: meta.subagentSharedFiles ?? [],
        }));
        const newTargets = new Set(declarations.map(declaration => declaration.targetPath));
        const baselines: ManagedFileBaseline[] = [];
        const removals = new Set<string>();

        Object.values(lock.sources).forEach((sourceMeta) => {
            (sourceMeta.subagentEntries ?? []).forEach((entry: SubagentEntry) => {
                baselines.push({ targetPath: entry.targetPath, hash: entry.hash });
                if (!newTargets.has(entry.targetPath)) {
                    removals.add(entry.targetPath);
                }
            });
            (sourceMeta.pluginEntries ?? []).forEach((entry: PluginEntry) => {
                baselines.push({ targetPath: entry.targetPath, hash: entry.hash });
                if (!newTargets.has(entry.targetPath)) {
                    removals.add(entry.targetPath);
                }
            });
            (sourceMeta.sharedEntries ?? [])
                .filter(entry => entry.owners.some(owner => owner.startsWith('subagent:')))
                .forEach((entry) => {
                    baselines.push({ targetPath: entry.targetPath, hash: entry.hash });
                    if (!newTargets.has(entry.targetPath) && !entry.owners.some(owner => owner.startsWith('skill:'))) {
                        removals.add(entry.targetPath);
                    }
                });
        });

        const planned = this.synchronizer.plan({
            files: declarations,
            removals: [...removals],
            baselines: force ? [] : baselines,
            rejectUnmanaged: !force,
        });
        if (!planned.ok) {
            return planned;
        }

        const result = this.resultForPlan(planned.plan, discovered, lock);
        return { ok: true, plan: planned.plan, result };
    }

    public synchronize({ lock, discovered, force = false }: { lock: LockData; discovered: DiscoveredSources; force?: boolean }): SubagentSyncResult {
        const planned = this.plan({ lock, discovered, force });
        if (!planned.ok) {
            const plugins = this.pluginSummary({ discovered, lock });
            return {
                subagentFailed: true,
                sources: Object.keys(discovered).length,
                sourceReports: this.sourceReports({ discovered, lock }),
                detected: this.detected(discovered),
                installed: 0,
                removed: 0,
                sharedFiles: 0,
                ...(plugins ? { plugins } : {}),
                errors: [{ message: planned.error, details: planned.details }],
            };
        }

        try {
            this.synchronizer.apply(planned.plan);
            return planned.result;
        }
        catch (error) {
            return {
                ...planned.result,
                subagentFailed: true,
                errors: [{ message: 'Failed while applying managed subagents.', details: error instanceof Error ? error.message : String(error) }],
            };
        }
    }

    private resultForPlan(plan: ManagedFilePlan, discovered: DiscoveredSources, lock: LockData): SubagentSyncResult {
        const sharedFiles = plan.files.filter(file => file.targetPath.startsWith('.agents/skills/_shared/')).length;
        const pluginTargets = new Set(
            Object.values(discovered).flatMap(meta => (meta.plugins ?? []).map(plugin => plugin.targetPath)),
        );
        const previousSubagentTargets = new Set(
            Object.values(lock.sources).flatMap(sourceMeta => [
                ...(sourceMeta.subagentEntries ?? []).map(entry => entry.targetPath),
                ...(sourceMeta.sharedEntries ?? [])
                    .filter(entry => entry.owners.some(owner => owner.startsWith('subagent:')))
                    .map(entry => entry.targetPath),
            ]),
        );
        const plugins = this.pluginSummary({ discovered, lock, plan });
        return {
            subagentFailed: false,
            sources: Object.keys(discovered).length,
            sourceReports: this.sourceReports({ discovered, lock, plan }),
            detected: this.detected(discovered),
            installed: plan.files.filter(file => !file.targetPath.startsWith('.agents/skills/_shared/') && !pluginTargets.has(file.targetPath)).length,
            removed: plan.removals.filter(target => previousSubagentTargets.has(target)).length,
            sharedFiles,
            ...(plugins ? { plugins } : {}),
            errors: [],
        };
    }

    private pluginSummary({ discovered, lock, plan }: {
        discovered: DiscoveredSources;
        lock: LockData;
        plan?: ManagedFilePlan;
    }): SyncPluginSummary | null {
        const pluginTargets = new Set(
            Object.values(discovered).flatMap(meta => (meta.plugins ?? []).map(plugin => plugin.targetPath)),
        );
        const detected = Object.values(discovered)
            .reduce((count, meta) => count + (meta.plugins?.length ?? 0), 0);
        const installed = plan?.files.filter(file => pluginTargets.has(file.targetPath)).length ?? 0;
        const previousTargets = new Set(
            Object.values(lock.sources).flatMap(sourceMeta => (sourceMeta.pluginEntries ?? []).map(entry => entry.targetPath)),
        );
        const removed = plan?.removals.filter(target => previousTargets.has(target)).length ?? 0;

        if (detected === 0 && installed === 0 && removed === 0) {
            return null;
        }

        return { detected, installed, removed };
    }

    private sourceReports({ discovered, lock, plan }: {
        discovered: DiscoveredSources;
        lock: LockData;
        plan?: ManagedFilePlan;
    }): SyncSourceReport[] {
        return Object.entries(discovered).map(([source, meta]) => {
            const sourceFiles = plan?.files.filter(file => file.owner === source) ?? [];
            const sourcePluginTargets = new Set((meta.plugins ?? []).map(plugin => plugin.targetPath));
            const sourceLock = Object.hasOwn(lock.sources, source) ? lock.sources[source] : null;
            const previousTargets = new Set([
                ...(sourceLock?.subagentEntries ?? []).map(entry => entry.targetPath),
                ...(sourceLock?.sharedEntries ?? [])
                    .filter(entry => entry.owners.some(owner => owner.startsWith('subagent:')))
                    .map(entry => entry.targetPath),
            ]);
            const sharedFiles = sourceFiles.filter(file => file.targetPath.startsWith('.agents/skills/_shared/')).length;
            return {
                source,
                mode: meta.subagentMode ?? (meta.subagents?.length ? 'all' : 'none'),
                selected: meta.subagents?.length ?? 0,
                installed: sourceFiles.filter(file => !file.targetPath.startsWith('.agents/skills/_shared/') && !sourcePluginTargets.has(file.targetPath)).length,
                removed: plan?.removals.filter(target => previousTargets.has(target)).length ?? 0,
                sharedFiles,
            };
        });
    }

    private detected(discovered: DiscoveredSources): number {
        return Object.values(discovered).reduce((count, meta) => count + (meta.subagents?.length ?? 0), 0);
    }
}
