import Helpers from '../shared/Helpers';
import type {
    DiscoveredSources,
    LockData,
    ManifestData,
    SkillEntry,
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

            if (this.sharedFileHashesSignature(lockMeta.sharedFileHashes) !== this.sharedFileHashesSignature(discoveredMeta.sharedFileHashes)) {
                return `Locked shared files for "${source}" do not match the source commit. ${UPDATE_HINT}`;
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

    private sharedFileHashesSignature(entries: { path: string; sha256: string }[]): string {
        return JSON.stringify(
            entries
                .map(entry => ({ path: entry.path, sha256: entry.sha256 }))
                .sort((a, b) => a.path.localeCompare(b.path)),
        );
    }

    private stringifySorted(values: string[]): string {
        return JSON.stringify(Helpers.sortUniq(values));
    }
}
