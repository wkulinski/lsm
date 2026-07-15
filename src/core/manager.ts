import { SkillsManager, type ManagerOptions } from './manager/SkillsManager';

export { SkillsManager };
export type { ManagerOptions };

export function createManager(options: ManagerOptions = {}): SkillsManager {
    return new SkillsManager(options);
}

export const manager = createManager;
