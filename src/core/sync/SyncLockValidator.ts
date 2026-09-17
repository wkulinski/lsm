import Helpers from '../shared/Helpers';
import Hashing from '../shared/Hashing';
import { lockManagedSharedFileHashes } from '../manifest/lockMappers';
import type {
    DiscoveredSources,
    LockData,
    ManifestData,
    PluginEntry,
    SkillEntry,
    SubagentEntry,
} from '../types';

const UPDATE_HINT = 'Run `lsm sync --update` to resolve sources and update the lock.';

export default class SyncLockValidator {
    public validateManifest({ manifest, lock }: { manifest: ManifestData; lock: LockData }): string | null {
        if (manifest.sources.length > 0 && Object.keys(lock.sources).length === 0) {
            return `Lock is empty. ${UPDATE_HINT}`;
        }

        if (this.stringifySorted(manifest.agents) !== this.stringifySorted(lock.agents)) {
            return `Lock agents do not match skills.json. ${UPDATE_HINT}`;
        }

        if ((manifest.subagents ?? []).length > 0 && lock.schemaVersion === 5) {
            return `Lock schema v5 cannot be used with subagents. ${UPDATE_HINT}`;
        }
        if (this.stringifySorted(manifest.subagents ?? []) !== this.stringifySorted(lock.subagents ?? [])) {
            return `Lock subagents do not match skills.json. ${UPDATE_HINT}`;
        }

        const manifestSources = Helpers.sortUniq(manifest.sources.map(entry => entry.source));
        const lockSources = Helpers.sortUniq(Object.keys(lock.sources));
        if (this.stringifySorted(manifestSources) !== this.stringifySorted(lockSources)) {
            return `Lock sources do not match skills.json. ${UPDATE_HINT}`;
        }

        for (const source of lockSources) {
            const resolvedCommit = lock.sources[source].resolved.resolvedCommit;
            if (!resolvedCommit) {
                return `Lock source "${source}" has no resolved commit. ${UPDATE_HINT}`;
            }
        }

        return null;
    }

    public validateDiscovered({ lock, discovered }: { lock: LockData; discovered: DiscoveredSources }): string | null {
        for (const [source, discoveredMeta] of Object.entries(discovered)) {
            if (!Object.hasOwn(lock.sources, source)) {
                return `Lock is missing source "${source}". ${UPDATE_HINT}`;
            }
            const lockMeta = lock.sources[source];

            if (lockMeta.mode !== discoveredMeta.mode) {
                return `Lock mode for "${source}" does not match skills.json. ${UPDATE_HINT}`;
            }

            if (lockMeta.resolved.resolvedCommit !== discoveredMeta.resolved.resolvedCommit) {
                return `Locked source "${source}" resolved to an unexpected commit. ${UPDATE_HINT}`;
            }

            if (discoveredMeta.missingRequested.length > 0) {
                return `Locked source "${source}" is missing requested skills. ${UPDATE_HINT}`;
            }

            if (this.skillEntriesSignature(lockMeta.skillEntries) !== this.skillEntriesSignature(discoveredMeta.skillEntries)) {
                return `Locked skill selection for "${source}" does not match skills.json. ${UPDATE_HINT}`;
            }

            if (this.subagentEntriesSignature(lockMeta.subagentEntries ?? []) !== this.subagentEntriesSignature(
                (discoveredMeta.subagents ?? []).map(subagent => ({
                    name: subagent.name,
                    sourcePath: subagent.sourcePath,
                    targetPath: subagent.targetPath,
                    sharedFiles: subagent.sharedFiles,
                    hash: subagent.hash,
                })),
            )) {
                return `Locked subagent selection for "${source}" does not match skills.json. ${UPDATE_HINT}`;
            }

            if (this.pluginEntriesSignature(lockMeta.pluginEntries ?? []) !== this.pluginEntriesSignature(
                (discoveredMeta.plugins ?? []).map(plugin => ({
                    sourcePath: plugin.sourcePath,
                    targetPath: plugin.targetPath,
                    hash: plugin.hash,
                })),
            )) {
                return `Locked plugin entries for "${source}" do not match the source commit. ${UPDATE_HINT}`;
            }

            const discoveredSharedFileHashes = discoveredMeta.managedSharedFileHashes ?? discoveredMeta.sharedFileHashes.map(entry => ({
                path: entry.path,
                hash: { sha256: entry.sha256, executable: false },
            }));
            const lockedSkillSharedEntries = Array.isArray(lockMeta.sharedEntries)
                ? lockMeta.sharedEntries
                    .filter(entry => entry.owners.length === 0 || entry.owners.some(owner => owner.startsWith('skill:')))
                    .map(entry => ({ path: entry.targetPath, hash: entry.hash }))
                : lockManagedSharedFileHashes(lockMeta);
            if (this.managedFileHashesSignature(lockedSkillSharedEntries) !== this.managedFileHashesSignature(discoveredSharedFileHashes)) {
                return `Locked shared files for "${source}" do not match the source commit. ${UPDATE_HINT}`;
            }

            const lockedSubagentSharedEntries = (lockMeta.sharedEntries ?? [])
                .filter(entry => entry.owners.some(owner => owner.startsWith('subagent:')));
            const discoveredSubagentSharedEntries = (discoveredMeta.subagentSharedFiles ?? []).map(file => ({
                path: file.path,
                hash: { sha256: Hashing.sha256Buffer(file.content), executable: file.executable },
            }));
            if (this.managedFileHashesSignature(lockedSubagentSharedEntries.map(entry => ({ path: entry.targetPath, hash: entry.hash }))) !== this.managedFileHashesSignature(discoveredSubagentSharedEntries)) {
                return `Locked subagent shared files for "${source}" do not match the source commit. ${UPDATE_HINT}`;
            }
        }

        return null;
    }

    private skillEntriesSignature(entries: SkillEntry[]): string {
        return JSON.stringify(
            entries
                .map(entry => ({
                    name: entry.name,
                    sourcePath: entry.sourcePath,
                    sharedFiles: Helpers.sortUniq(entry.sharedFiles),
                    hash: entry.hash
                        ? {
                            treeSha256: entry.hash.treeSha256,
                            files: entry.hash.files.map(file => ({ path: file.path, sha256: file.sha256 })),
                        }
                        : null,
                }))
                .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
        );
    }

    private managedFileHashesSignature(entries: { path: string; hash: { sha256: string; executable: boolean } }[]): string {
        return JSON.stringify(
            entries
                .map(entry => ({ path: entry.path, hash: entry.hash }))
                .sort((a, b) => a.path.localeCompare(b.path)),
        );
    }

    private subagentEntriesSignature(entries: SubagentEntry[]): string {
        return JSON.stringify(entries.map(entry => ({
            name: entry.name,
            sourcePath: entry.sourcePath,
            targetPath: entry.targetPath,
            sharedFiles: Helpers.sortUniq(entry.sharedFiles),
            hash: entry.hash,
        })).sort((a, b) => a.name.localeCompare(b.name)));
    }

    private pluginEntriesSignature(entries: PluginEntry[]): string {
        return JSON.stringify(entries.map(entry => ({
            sourcePath: entry.sourcePath,
            targetPath: entry.targetPath,
            hash: entry.hash,
        })).sort((a, b) => a.targetPath.localeCompare(b.targetPath)));
    }

    private stringifySorted(values: string[]): string {
        return JSON.stringify(Helpers.sortUniq(values));
    }
}
