import path from 'node:path';

import Helpers from '../shared/Helpers';
import { isPathInside } from '../filesystem/PathUtils';
import SourcePathMapper from '../source/SourcePathMapper';
import type {
    BackendLike,
    LockSourceMeta,
    SkillEntry,
} from '../types';

export default class SyncPathMapper {
    public backend: BackendLike;
    private readonly sourcePathMapper = new SourcePathMapper();

    public constructor({ backend }: { backend: BackendLike }) {
        this.backend = backend;
    }

    public collectSharedFilesFromSkillEntries(skillEntries: SkillEntry[] | undefined): string[] {
        return Helpers.sortUniq(
            (Array.isArray(skillEntries) ? skillEntries : [])
                .flatMap(entry => (Array.isArray(entry.sharedFiles) ? entry.sharedFiles : []))
                .map(entry => entry.trim())
                .filter(Boolean),
        );
    }

    public resolveSourceSkillsRootPrefix(skillEntries: { sourcePath?: string }[] | undefined): { ok: boolean; error?: string; prefix?: string } {
        const result = this.sourcePathMapper.resolveSkillsRootPrefix(skillEntries ?? []);

        if (!result.ok && result.prefixes.length === 0) {
            return { ok: false, error: 'Cannot infer source skills root from skillEntries.' };
        }
        if (!result.ok) {
            return { ok: false, error: `Multiple skills roots detected: ${result.prefixes.join(', ')}` };
        }

        return result;
    }

    public extractSkillsRootPrefix(sourcePath: unknown): string | null {
        return this.sourcePathMapper.extractSkillsRootPrefix(sourcePath);
    }

    public relativeToSkillsRoot(sourcePath: unknown, skillsRootPrefix: unknown): string | null {
        return this.sourcePathMapper.relativeToSkillsRoot(sourcePath, skillsRootPrefix);
    }

    public mapSourceSharedFilesToLocalPaths(
        { sourcePaths, sourceMeta, agentSkillDirs }: { sourcePaths: string[]; sourceMeta: LockSourceMeta; agentSkillDirs: string[] },
    ): string[] {
        const rootResult = this.resolveSourceSkillsRootPrefix(sourceMeta.skillEntries);
        if (!rootResult.ok) {
            return [];
        }

        const mapped = new Set<string>();
        (Array.isArray(sourcePaths) ? sourcePaths : []).forEach((sourcePath) => {
            const relativeToSkillsRoot = this.relativeToSkillsRoot(sourcePath, rootResult.prefix);
            if (!relativeToSkillsRoot) {
                return;
            }

            agentSkillDirs.forEach((agentSkillDir) => {
                const destinationPath = path.resolve(agentSkillDir, relativeToSkillsRoot);
                if (!this.isPathInsideRoot(destinationPath)) {
                    return;
                }

                mapped.add(this.toProjectRelativePath(destinationPath));
            });
        });

        return Helpers.sortUniq([...mapped]);
    }

    public toProjectRelativePath(absolutePath: string): string {
        const relative = path.relative(this.backend.root, absolutePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`Path escapes project root: ${absolutePath}`);
        }
        return relative.split(path.sep).join('/');
    }

    public isPathInsideRoot(absolutePath: string): boolean {
        return isPathInside(absolutePath, this.backend.root);
    }
}
