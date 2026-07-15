import type { SyncPreflightConflict } from '../types';

export default class SyncPreflightConflictSet {
    private readonly keys = new Set<string>();
    private readonly conflicts: SyncPreflightConflict[] = [];

    public add(conflict: Partial<SyncPreflightConflict>): void {
        const normalizedPath = conflict.path?.trim() ?? '';
        const normalizedReason = conflict.reason?.trim() ?? '';
        if (!normalizedPath || !normalizedReason) {
            return;
        }

        const key = `${normalizedPath}\0${normalizedReason}`;
        if (this.keys.has(key)) {
            return;
        }

        this.keys.add(key);
        this.conflicts.push({
            path: normalizedPath,
            reason: normalizedReason,
            operation: conflict.operation?.trim() ?? 'overwrite',
            scope: conflict.scope?.trim() ?? 'unknown',
            source: conflict.source ?? null,
            skill: conflict.skill ?? null,
        });
    }

    public toSortedArray(): SyncPreflightConflict[] {
        return [...this.conflicts].sort((a, b) => a.path.localeCompare(b.path));
    }
}
