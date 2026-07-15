import Helpers from '../shared/Helpers';
import type {
    DiscoveredSources,
    LockData,
    LockSourceMeta,
    ManagedSkillEntry,
    ManifestData,
    SkillEntry,
    SyncPlan,
} from '../types';

export interface SyncPlannerManifestStoreLike {
    lockManagedSkills(lockSources: { [key: string]: LockSourceMeta } | undefined): string[];
}

export default class SyncPlanner {
    private readonly manifestStore: SyncPlannerManifestStoreLike;

    public constructor({ manifestStore }: { manifestStore: SyncPlannerManifestStoreLike }) {
        this.manifestStore = manifestStore;
    }

    public planRemovals({ lock, manifest, discovered }: { lock: LockData; manifest: ManifestData; discovered: DiscoveredSources }): SyncPlan {
        const oldAgents = lock.agents;
        const newAgents = manifest.agents;
        const agentsUnion = Helpers.sortUniq([...oldAgents, ...newAgents]);
        const agentsRemoved = oldAgents.filter(agent => !newAgents.includes(agent));

        const oldManagedEntries = Helpers.sortUniq(
            Object.values(lock.sources)
                .flatMap(sourceMeta => (Array.isArray(sourceMeta.skillEntries) ? sourceMeta.skillEntries : []))
                .filter((entry): entry is SkillEntry => Boolean(entry.sourcePath))
                .map(entry => JSON.stringify({
                    name: entry.name.trim(),
                    sourcePath: entry.sourcePath.trim(),
                })),
        ).map(entry => JSON.parse(entry) as ManagedSkillEntry);
        const oldManaged = this.manifestStore.lockManagedSkills(lock.sources);
        const newManaged = Helpers.sortUniq(Object.values(discovered).flatMap(sourceMeta => sourceMeta.skills));

        const newSet = new Set(newManaged);
        const skillsRemoved = oldManaged.filter(skillName => !newSet.has(skillName));
        const removedSkillSet = new Set(skillsRemoved.map(skillName => skillName.toLowerCase()));
        const skillsRemovedEntries = oldManagedEntries.filter(entry => removedSkillSet.has(entry.name.toLowerCase()));

        return {
            oldAgents,
            newAgents,
            agentsUnion,
            agentsRemoved,
            oldManaged,
            oldManagedEntries,
            newManaged,
            skillsRemoved,
            skillsRemovedEntries,
        };
    }
}
