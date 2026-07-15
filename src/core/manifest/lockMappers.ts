import type {
    DiscoveredSources,
    FileHashEntry,
    LockSourceMeta,
    SkillEntry,
} from '../types';
import Helpers from '../shared/Helpers';
import LockNormalizer from './LockNormalizer';

export function lockSourcesFromDiscovered(
    discovered: DiscoveredSources,
    sharedFileHashesBySource: { [key: string]: FileHashEntry[] },
): { [key: string]: LockSourceMeta } {
    return Object.fromEntries(
        Object.entries(discovered).map(([source, meta]) => [
            source,
            {
                mode: meta.mode,
                listedAt: meta.listedAt,
                skillEntries: meta.skillEntries.map((entry: SkillEntry) => ({
                    name: entry.name,
                    sourcePath: entry.sourcePath,
                    sharedFiles: entry.sharedFiles,
                    hash: entry.hash,
                })),
                sharedFileHashes: sharedFileHashesBySource[source] ?? [],
                resolved: meta.resolved,
            },
        ]),
    );
}

export function lockManagedSkills(lockSources: { [key: string]: LockSourceMeta } | undefined): string[] {
    return Helpers.sortUniq(
        Object.values(lockSources ?? {})
            .flatMap((v: LockSourceMeta) => (Array.isArray(v.skillEntries) ? v.skillEntries : []))
            .map((entry: SkillEntry) => entry.name.trim())
            .map((s: string) => s.trim())
            .filter(Boolean),
    );
}

export function lockManagedSharedFilesBySource(
    lockSources: { [key: string]: LockSourceMeta } | undefined,
    { lockFileName = 'skills.lock.json' }: { lockFileName?: string } = {},
): { [key: string]: string[] } {
    const normalizedSources = new LockNormalizer({ lockFileName }).normalizeLockSources(lockSources);
    return Object.fromEntries(
        Object.entries(normalizedSources).map(([source, meta]) => {
            const files = Helpers.sortUniq([
                ...meta.sharedFileHashes.map((entry: FileHashEntry) => entry.path.trim()),
                ...meta.skillEntries
                    .flatMap((entry: SkillEntry) => (Array.isArray(entry.sharedFiles) ? entry.sharedFiles : []))
                    .map((filePath: string) => filePath.trim()),
            ].filter(Boolean));
            return [source, files];
        }),
    );
}
