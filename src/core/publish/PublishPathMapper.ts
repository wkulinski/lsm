import path from 'node:path';

import SourcePathMapper from '../source/SourcePathMapper';
import type {
    LockSourceMeta,
    SkillEntry,
} from '../types';
import type { PublishErrorResult } from './PublishParameterResolver';

export default class PublishPathMapper {
    private readonly sourcePathMapper = new SourcePathMapper();

    public resolveManagedEntries(lockSource: LockSourceMeta): SkillEntry[] {
        if (!Array.isArray(lockSource.skillEntries)) {
            return [];
        }

        return lockSource.skillEntries.map((entry: SkillEntry) => ({
            name: entry.name,
            sourcePath: this.normalizePosix(entry.sourcePath),
            sharedFiles: this.normalizeSharedFiles(entry.sharedFiles),
            hash: entry.hash,
        }));
    }

    public resolveManagedSkillOwners(lockSources: { [key: string]: LockSourceMeta } | undefined): Map<string, string> {
        const owners = new Map<string, string>();
        Object.entries(lockSources ?? {}).forEach(([source, sourceMeta]) => {
            const entries = this.resolveManagedEntries(sourceMeta);
            entries.forEach((entry: SkillEntry) => {
                const key = entry.name.trim().toLowerCase();
                if (!key || owners.has(key)) {
                    return;
                }
                owners.set(key, source);
            });
        });
        return owners;
    }

    public resolveSharedFileOwners(lockSources: { [key: string]: LockSourceMeta } | undefined, localSkillsRootPrefix: string): Map<string, string> {
        const owners = new Map<string, string>();

        Object.entries(lockSources ?? {}).forEach(([source, sourceMeta]) => {
            const sourceEntries = this.resolveManagedEntries(sourceMeta);
            const sourceRoot = this.resolveSourceSkillsRootPrefix(sourceEntries);
            if (!sourceRoot.ok) {
                return;
            }

            (Array.isArray(sourceMeta.skillEntries) ? sourceMeta.skillEntries : []).forEach((entry: SkillEntry) => {
                const sharedFiles = Array.isArray(entry.sharedFiles) ? entry.sharedFiles : [];
                sharedFiles.forEach((sourceSharedFilePath: string) => {
                    const relativePath = this.relativeToSkillsRoot(sourceSharedFilePath, sourceRoot.prefix);
                    if (!relativePath) {
                        return;
                    }

                    const localPath = this.normalizePosix(path.posix.join(localSkillsRootPrefix, relativePath));
                    if (!owners.has(localPath)) {
                        owners.set(localPath, source);
                    }
                });
            });
        });

        return owners;
    }

    public resolveSourceSkillsRootPrefix(entries: { sourcePath?: string }[]): { ok: true; prefix: string } | PublishErrorResult {
        const result = this.sourcePathMapper.resolveSkillsRootPrefix(entries);

        if (!result.ok && result.prefixes.length === 0) {
            return { ok: false, error: 'No skills root could be inferred.' };
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

    public normalizeSharedFiles(values: unknown): string[] {
        return [...new Set(
            (Array.isArray(values) ? values : [])
                .map((entry: unknown) => (typeof entry === 'string' ? this.normalizePosix(entry.trim()) : ''))
                .filter(Boolean),
        )].sort((a, b) => a.localeCompare(b));
    }

    public collectSharedFilesFromSkillEntries(skillEntries: SkillEntry[] | undefined): string[] {
        return [...new Set(
            (Array.isArray(skillEntries) ? skillEntries : [])
                .flatMap((entry: SkillEntry) => (Array.isArray(entry.sharedFiles) ? entry.sharedFiles : []))
                .map(entry => this.normalizePosix(entry.trim()))
                .filter(Boolean),
        )].sort((a, b) => a.localeCompare(b));
    }

    public normalizePosix(value: unknown): string {
        return this.sourcePathMapper.normalizePosix(value);
    }
}
