import {
    extractSkillsRootPrefix,
    normalizePosixPath,
    relativeToSkillsRoot,
} from '../filesystem/PathUtils';
import type { Result } from '../shared/Result';

export interface SourcePathEntry {
    sourcePath?: string;
}

export type SkillsRootResult = Result<{ prefix: string }, { prefixes: string[] }>;

export default class SourcePathMapper {
    public normalizePosix(value: unknown): string {
        return normalizePosixPath(value);
    }

    public extractSkillsRootPrefix(sourcePath: unknown): string | null {
        return extractSkillsRootPrefix(sourcePath);
    }

    public relativeToSkillsRoot(sourcePath: unknown, skillsRootPrefix: unknown): string | null {
        return relativeToSkillsRoot(sourcePath, skillsRootPrefix);
    }

    public resolveSkillsRootPrefix(entries: SourcePathEntry[]): SkillsRootResult {
        const prefixes = [...new Set(
            (Array.isArray(entries) ? entries : [])
                .map(entry => this.extractSkillsRootPrefix(entry.sourcePath))
                .filter((value): value is string => Boolean(value)),
        )].sort((a, b) => a.localeCompare(b));

        if (prefixes.length !== 1) {
            return { ok: false, prefixes };
        }

        return { ok: true, prefix: prefixes[0] };
    }
}
