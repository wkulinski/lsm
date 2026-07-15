import Helpers from '../shared/Helpers';
import type {
    BackendLike,
    SyncPlan,
    SyncRemovalSummary,
} from '../types';

export default class RemovalPhase {
    public backend: BackendLike;

    public constructor({ backend }: { backend: BackendLike }) {
        this.backend = backend;
    }

    public removePhase(plan: SyncPlan): SyncRemovalSummary {
        const { agentsRemoved, oldManaged, oldManagedEntries, agentsUnion, skillsRemoved, skillsRemovedEntries } = plan;
        const summary = {
            removedFromRemovedAgents: oldManaged.length,
            prunedSkills: skillsRemoved.length,
            removedAgents: agentsRemoved,
            agentsUnion,
            hadNothingToPrune: !(skillsRemoved.length && agentsUnion.length),
        };

        if (agentsRemoved.length && oldManaged.length) {
            this.chunk(oldManaged, 25).forEach((group) => {
                const entries = oldManagedEntries.filter(entry => group.some(skillName => skillName.toLowerCase() === entry.name.toLowerCase()));
                const res = this.backend.removeSkillEntries({ skillEntries: entries, agents: agentsRemoved });
                if (!res.ok) {
                    throw Helpers.error('Failed while removing managed skills from removed agents.', {
                        status: res.status,
                        cmd: res.cmd,
                        error: res.error,
                        details: res.details,
                    });
                }
            });
        }

        if (skillsRemoved.length && agentsUnion.length) {
            this.chunk(skillsRemoved, 25).forEach((group) => {
                const entries = skillsRemovedEntries.filter(entry => group.some(skillName => skillName.toLowerCase() === entry.name.toLowerCase()));
                const res = this.backend.removeSkillEntries({ skillEntries: entries, agents: agentsUnion });
                if (!res.ok) {
                    throw Helpers.error('Failed while pruning removed or missing skills.', {
                        status: res.status,
                        cmd: res.cmd,
                        error: res.error,
                        details: res.details,
                    });
                }
            });
        }

        return summary;
    }

    private chunk<T>(arr: T[], n: number): T[][] {
        return Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    }
}
