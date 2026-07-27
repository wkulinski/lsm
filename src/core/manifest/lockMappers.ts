import type {
    DiscoveredSources,
    FileHashEntry,
    LockSourceMeta,
    ManagedFileHashEntry,
    SharedEntry,
    SkillEntry,
    SubagentDefinition,
} from '../types';
import Helpers from '../shared/Helpers';
import Hashing from '../shared/Hashing';
import LockNormalizer from './LockNormalizer';

export function lockSourcesFromDiscovered(
    discovered: DiscoveredSources,
    sharedFileHashesBySource: { [key: string]: FileHashEntry[] },
    managedFileHashesBySource: { [key: string]: ManagedFileHashEntry[] } = {},
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
                subagentEntries: (meta.subagents ?? []).map(subagent => ({
                    name: subagent.name,
                    sourcePath: subagent.sourcePath,
                    targetPath: subagent.targetPath,
                    sharedFiles: subagent.sharedFiles,
                    hash: subagent.hash,
                })),
                sharedEntries: sharedEntriesFromHashes(
                    sharedFileHashesBySource[source] ?? [],
                    managedFileHashesBySource[source] ?? [],
                    meta.skillEntries,
                    meta.subagents ?? [],
                    meta.subagentSharedFiles ?? [],
                ),
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
    const normalizer = new LockNormalizer({ lockFileName });
    const normalizedSources = Object.fromEntries(
        Object.entries(lockSources ?? {}).map(([source, meta]) => [
            source,
            Array.isArray(meta.sharedEntries)
                ? meta
                : normalizer.normalizeLockSources({ [source]: meta })[source],
        ]),
    );
    return Object.fromEntries(
        Object.entries(normalizedSources).map(([source, meta]) => {
            const files = Helpers.sortUniq([
                ...lockSharedFileHashes(meta).map((entry: FileHashEntry) => entry.path.trim()),
                ...meta.skillEntries
                    .flatMap((entry: SkillEntry) => (Array.isArray(entry.sharedFiles) ? entry.sharedFiles : []))
                    .map((filePath: string) => filePath.trim()),
            ].filter(Boolean));
            return [source, files];
        }),
    );
}

export function lockSharedFileHashes(meta: LockSourceMeta): FileHashEntry[] {
    if (Array.isArray(meta.sharedEntries)) {
        return meta.sharedEntries.map(entry => ({
            path: entry.targetPath,
            sha256: entry.hash.sha256,
        }));
    }
    return meta.sharedFileHashes ?? [];
}

export function lockManagedSharedFileHashes(meta: LockSourceMeta): ManagedFileHashEntry[] {
    if (Array.isArray(meta.sharedEntries)) {
        return meta.sharedEntries.map(entry => ({
            path: entry.targetPath,
            hash: entry.hash,
        }));
    }
    return (meta.sharedFileHashes ?? []).map(entry => ({
        path: entry.path,
        hash: {
            sha256: entry.sha256,
            executable: false,
        },
    }));
}

function sharedEntriesFromHashes(
    hashes: FileHashEntry[],
    managedHashes: ManagedFileHashEntry[],
    skillEntries: SkillEntry[],
    subagents: SubagentDefinition[],
    subagentSharedFiles: { path: string; content: Buffer; executable: boolean }[],
): SharedEntry[] {
    const effectiveHashes = managedHashes.length > 0
        ? managedHashes
        : hashes.map(entry => ({
            path: entry.path,
            hash: {
                sha256: entry.sha256,
                executable: false,
            },
        }));

    const entries = new Map<string, SharedEntry>();
    effectiveHashes.forEach((entry) => {
        entries.set(entry.path, {
            sourcePath: entry.path,
            targetPath: entry.path,
            hash: entry.hash,
            owners: skillEntries
                .filter(skill => skill.sharedFiles.includes(entry.path))
                .map(skill => `skill:${skill.name}`)
                .sort((a, b) => a.localeCompare(b)),
        });
    });

    subagentSharedFiles.forEach((file) => {
        const existing = entries.get(file.path);
        const owners = subagents
            .filter(subagent => subagent.sharedFiles.includes(file.path))
            .map(subagent => `subagent:${subagent.name}`);
        entries.set(file.path, {
            sourcePath: file.path,
            targetPath: file.path,
            hash: {
                sha256: Hashing.sha256Buffer(file.content),
                executable: file.executable,
            },
            owners: Helpers.sortUniq([...(existing?.owners ?? []), ...owners]),
        });
    });

    return [...entries.values()].sort((left, right) => left.targetPath.localeCompare(right.targetPath));
}
