import type {
    BackendLike,
    DiscoveredSources,
    SyncInstallResult,
} from '../types';

export default class SyncInstallPhase {
    private readonly backend: BackendLike;

    public constructor({ backend }: { backend: BackendLike }) {
        this.backend = backend;
    }

    public addPhase(discovered: DiscoveredSources, agents: string[]): { installs: SyncInstallResult[]; addFailed: boolean } {
        const installs: SyncInstallResult[] = [];
        let addFailed = false;

        Object.entries(discovered).forEach(([source, meta]) => {
            const desired = meta.skills;

            if (!desired.length) {
                installs.push({ source, ok: true, skipped: true });
                return;
            }

            const res = this.backend.installSkillEntries({
                source,
                skillEntries: meta.skillEntries,
                agents,
            });

            installs.push({ source, ...res });
            if (!res.ok) {
                addFailed = true;
            }
        });

        return { installs, addFailed };
    }
}
