import path from 'node:path';

import type { PluginDefinition, SharedFileContentEntry, SubagentDefinition } from '../types';
import type { ManagedFileDeclaration } from '../sync/ManagedFileSynchronizer';

const SHARED_ROOT = '.agents/skills/_shared';

export default class SubagentManagedFileAdapter {
    public declarations({
        source,
        subagents,
        plugins = [],
        sharedFiles,
    }: {
        source: string;
        subagents: SubagentDefinition[];
        plugins?: PluginDefinition[];
        sharedFiles: SharedFileContentEntry[];
    }): ManagedFileDeclaration[] {
        const declarations: ManagedFileDeclaration[] = subagents.map(subagent => ({
            owner: source,
            sourcePath: subagent.sourcePath,
            targetPath: subagent.targetPath,
            content: subagent.content,
            executable: subagent.hash.executable,
        }));

        declarations.push(...plugins.map(plugin => ({
            owner: source,
            sourcePath: plugin.sourcePath,
            targetPath: plugin.targetPath,
            content: plugin.content,
            executable: plugin.hash.executable,
        })));

        sharedFiles.forEach((file) => {
            const sourcePath = file.path.replace(/\\/g, '/');
            if (sourcePath !== SHARED_ROOT && !sourcePath.startsWith(`${SHARED_ROOT}/`)) {
                throw new Error(`Subagent shared file must be inside ${SHARED_ROOT}: ${sourcePath}`);
            }
            declarations.push({
                owner: source,
                sourcePath,
                targetPath: path.posix.normalize(sourcePath),
                content: file.content,
                executable: file.executable,
            });
        });

        return declarations.sort((left, right) => left.targetPath.localeCompare(right.targetPath));
    }
}
