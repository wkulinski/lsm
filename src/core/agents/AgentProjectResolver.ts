import path from 'node:path';

import AgentRegistry from './AgentRegistry';
import Helpers from '../shared/Helpers';
import type { AgentProjectSkillDirsResult } from '../types';

export default class AgentProjectResolver {
    private readonly root: string;

    public constructor({ root }: { root: string }) {
        this.root = root;
    }

    public resolveSkillDirs(agents: string[]): AgentProjectSkillDirsResult {
        if (!Array.isArray(agents) || agents.length === 0) {
            return { ok: false, error: 'No agents configured for copy sync.' };
        }

        const resolved: string[] = [];
        for (const agent of agents) {
            const normalizedAgent = agent.trim().toLowerCase();
            if (!normalizedAgent || normalizedAgent === '*') {
                return { ok: false, error: "Copy sync requires explicit agent names (wildcard '*' is not supported)." };
            }

            const skillsDir = AgentRegistry.projectSkillsDir(normalizedAgent);
            if (!skillsDir) {
                return {
                    ok: false,
                    error: `Unsupported agent for copy sync: "${agent}". Add mapping in AgentRegistry.`,
                };
            }

            resolved.push(path.resolve(this.root, skillsDir));
        }

        return { ok: true, dirs: Helpers.sortUniq(resolved) };
    }
}
