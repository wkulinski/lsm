import Helpers from '../shared/Helpers';
import type { DiscoveredSources } from '../types';

export default class SyncDiscoveryConflicts {
    public assertNoConflicts(discovered: DiscoveredSources): void {
        const skillToSource = new Map<string, string>();
        const conflicts: { skill: string; a: string; b: string }[] = [];

        Object.entries(discovered).forEach(([src, meta]) => {
            meta.skills.forEach((skill) => {
                const key = skill.toLowerCase();
                const prev = skillToSource.get(key);
                if (prev && prev !== src) {
                    conflicts.push({ skill, a: prev, b: src });
                }
                else {
                    skillToSource.set(key, src);
                }
            });
        });

        if (conflicts.length) {
            throw Helpers.error('Skill name conflicts detected.', conflicts);
        }
    }
}
