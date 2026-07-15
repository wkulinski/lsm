import path from 'node:path';

import SyncPathMapper from './SyncPathMapper';
import type {
    BackendLike,
    DiscoveredSources,
} from '../types';

export interface SyncPreflightManagedLocalPaths {
    skillDirs: Set<string>;
    sharedFiles: Set<string>;
}

export default class SyncPreflightManagedPaths {
    private readonly pathMapper: SyncPathMapper;

    public constructor({ backend, pathMapper }: { backend: BackendLike; pathMapper?: SyncPathMapper }) {
        this.pathMapper = pathMapper ?? new SyncPathMapper({ backend });
    }

    public collectNewManagedLocalPaths(
        { discovered, currentAgentSkillDirs }: { discovered: DiscoveredSources; currentAgentSkillDirs: string[] },
    ): SyncPreflightManagedLocalPaths {
        const managedSkillDirs = new Set<string>();
        const managedSharedFiles = new Set<string>();

        Object.values(discovered).forEach((meta) => {
            const skillEntries = Array.isArray(meta.skillEntries) ? meta.skillEntries : [];
            const sourceSkillsRoot = this.pathMapper.resolveSourceSkillsRootPrefix(skillEntries);
            if (!sourceSkillsRoot.ok) {
                return;
            }

            skillEntries.forEach((entry) => {
                const relativePath = this.pathMapper.relativeToSkillsRoot(entry.sourcePath, sourceSkillsRoot.prefix);
                if (!relativePath) {
                    return;
                }

                currentAgentSkillDirs.forEach((agentSkillDir) => {
                    const localSkillDir = path.resolve(agentSkillDir, relativePath);
                    if (!this.pathMapper.isPathInsideRoot(localSkillDir)) {
                        return;
                    }

                    managedSkillDirs.add(this.pathMapper.toProjectRelativePath(localSkillDir));
                });
            });

            const sharedFiles = this.pathMapper.collectSharedFilesFromSkillEntries(skillEntries);
            sharedFiles.forEach((sourceSharedFilePath) => {
                const relativePath = this.pathMapper.relativeToSkillsRoot(sourceSharedFilePath, sourceSkillsRoot.prefix);
                if (!relativePath) {
                    return;
                }

                currentAgentSkillDirs.forEach((agentSkillDir) => {
                    const localSharedFilePath = path.resolve(agentSkillDir, relativePath);
                    if (!this.pathMapper.isPathInsideRoot(localSharedFilePath)) {
                        return;
                    }

                    managedSharedFiles.add(this.pathMapper.toProjectRelativePath(localSharedFilePath));
                });
            });
        });

        return {
            skillDirs: managedSkillDirs,
            sharedFiles: managedSharedFiles,
        };
    }
}
