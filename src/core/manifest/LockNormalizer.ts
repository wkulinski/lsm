import Helpers from '../shared/Helpers';
import { formatUnknown } from '../utils/formatUnknown';
import type {
    FileHashEntry,
    LockData,
    LockSourceMeta,
    ManagedFileHash,
    ResolvedSourceMeta,
    SharedEntry,
    SkillEntry,
    SkillTreeHash,
    SubagentEntry,
} from '../types';

export const LEGACY_LOCK_SCHEMA_VERSION = 5;
export const LOCK_SCHEMA_VERSION = 6;

interface UnknownRecord { [key: string]: unknown }

export default class LockNormalizer {
    private readonly lockFileName: string;

    public constructor({ lockFileName }: { lockFileName: string }) {
        this.lockFileName = lockFileName;
    }

    public emptyLock(): LockData {
        return { schemaVersion: LOCK_SCHEMA_VERSION, agents: [], subagents: [], sources: {} };
    }

    public normalize(json: unknown): LockData {
        const record = json as UnknownRecord;
        if (record.schemaVersion === LEGACY_LOCK_SCHEMA_VERSION) {
            return this.normalizeV5(record);
        }
        if (record.schemaVersion === LOCK_SCHEMA_VERSION) {
            return this.normalizeV6(record);
        }
        return Helpers.die(
            `"${this.lockFileName}": unsupported schemaVersion=${formatUnknown(record.schemaVersion)}; expected 5 or 6`,
        );
    }

    public normalizeV5(record: UnknownRecord): LockData {
        const agents = this.normalizeAgents(record.agents);
        const sources = this.normalizeLockSources(record.sources, LEGACY_LOCK_SCHEMA_VERSION);

        return {
            schemaVersion: LEGACY_LOCK_SCHEMA_VERSION,
            agents,
            subagents: [],
            sources,
        };
    }

    public normalizeV6(record: UnknownRecord): LockData {
        const agents = this.normalizeAgents(record.agents);
        const subagents = this.normalizeSubagentTargets(record.subagents);
        const sources = this.normalizeLockSources(record.sources, LOCK_SCHEMA_VERSION);

        return {
            schemaVersion: LOCK_SCHEMA_VERSION,
            agents,
            subagents,
            sources,
        };
    }

    public normalizeLockSources(rawSources: unknown, schemaVersion: number = LEGACY_LOCK_SCHEMA_VERSION): { [key: string]: LockSourceMeta } {
        if (!rawSources || typeof rawSources !== 'object') {
            return {};
        }

        return Object.fromEntries(
            Object.entries(rawSources)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([source, meta]) => {
                    const normalizedMeta: UnknownRecord = meta && typeof meta === 'object' ? meta as UnknownRecord : {};

                    const sharedFileHashes = this.normalizeLockSharedFileHashes(normalizedMeta.sharedFileHashes);
                    const skillEntries = this.normalizeLockSkillEntries(normalizedMeta.skillEntries);
                    const sharedEntries = schemaVersion === LEGACY_LOCK_SCHEMA_VERSION
                        ? this.sharedEntriesFromLegacyHashes(sharedFileHashes, skillEntries)
                        : this.normalizeLockSharedEntries(normalizedMeta.sharedEntries);

                    return [source, {
                        mode: typeof normalizedMeta.mode === 'string' ? normalizedMeta.mode : 'all',
                        listedAt: typeof normalizedMeta.listedAt === 'string' ? normalizedMeta.listedAt : null,
                        skillEntries,
                        ...(schemaVersion === LEGACY_LOCK_SCHEMA_VERSION ? { sharedFileHashes } : {}),
                        subagentEntries: schemaVersion === LOCK_SCHEMA_VERSION
                            ? this.normalizeLockSubagentEntries(normalizedMeta.subagentEntries)
                            : [],
                        sharedEntries,
                        resolved: this.normalizeLockResolved(normalizedMeta.resolved),
                    }];
                }),
        );
    }

    public toV6Sources(sources: { [key: string]: LockSourceMeta }): { [key: string]: LockSourceMeta } {
        return Object.fromEntries(
            Object.entries(sources)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([source, meta]) => {
                    const normalized = this.normalizeLockSources({ [source]: meta }, LOCK_SCHEMA_VERSION)[source];
                    const sharedEntries = normalized.sharedEntries && normalized.sharedEntries.length > 0
                        ? normalized.sharedEntries
                        : this.sharedEntriesFromLegacyHashes(meta.sharedFileHashes ?? [], normalized.skillEntries);

                    return [source, {
                        mode: normalized.mode,
                        listedAt: normalized.listedAt,
                        skillEntries: normalized.skillEntries,
                        subagentEntries: normalized.subagentEntries ?? [],
                        sharedEntries,
                        resolved: normalized.resolved,
                    }];
                }),
        );
    }

    private normalizeAgents(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }
        return Helpers.sortUniq(value.map(String).map(s => s.trim()).filter(Boolean));
    }

    private normalizeSubagentTargets(value: unknown): string[] {
        if (value === null || typeof value === 'undefined') {
            return [];
        }
        if (!Array.isArray(value)) {
            Helpers.die(`"${this.lockFileName}": "subagents" must be an array when present`);
        }
        const targets = value.map((entry: unknown) => {
            if (typeof entry !== 'string' || !entry.trim()) {
                Helpers.die(`"${this.lockFileName}": "subagents" contains empty/non-string value`);
            }
            return entry.trim();
        });
        targets.forEach((target) => {
            if (target !== 'opencode') {
                Helpers.die(`"${this.lockFileName}": unsupported subagent target "${target}"; expected "opencode"`);
            }
        });
        return Helpers.sortUniq(targets);
    }

    public normalizeLockSkillEntries(entries: unknown): SkillEntry[] {
        if (!Array.isArray(entries)) {
            Helpers.die(`"${this.lockFileName}": "skillEntries" must be an array`);
        }

        const normalized = entries
            .filter(entry => entry && typeof entry === 'object')
            .map((entry: UnknownRecord) => {
                const name = typeof entry.name === 'string' ? entry.name.trim() : '';
                if (!name) {
                    return null;
                }

                const sourcePath = this.normalizeRelativePath(
                    entry.sourcePath ?? '',
                    'lock.skillEntries.sourcePath',
                    this.lockFileName,
                );

                const sharedFiles = Helpers.sortUniq(
                    (Array.isArray(entry.sharedFiles) ? entry.sharedFiles : [])
                        .map((sharedFilePath: unknown) => this.normalizeRelativePath(
                            sharedFilePath,
                            'lock.skillEntries.sharedFiles',
                            this.lockFileName,
                        )),
                );

                const hash = this.normalizeLockSkillHash(entry.hash);

                return { name, sourcePath, sharedFiles, hash };
            })
            .filter((entry): entry is SkillEntry => Boolean(entry));

        const unique = new Map<string, SkillEntry>();
        normalized.forEach((entry: SkillEntry) => {
            const key = entry.name.toLowerCase();
            if (!unique.has(key)) {
                unique.set(key, entry);
            }
        });

        return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    public normalizeLockSubagentEntries(entries: unknown): SubagentEntry[] {
        if (!Array.isArray(entries)) {
            return [];
        }

        const normalized = entries
            .filter(entry => entry && typeof entry === 'object')
            .map((entry: UnknownRecord) => {
                const name = typeof entry.name === 'string' ? entry.name.trim() : '';
                if (!name) {
                    return null;
                }

                return {
                    name,
                    sourcePath: this.normalizeRelativePath(entry.sourcePath ?? '', 'lock.subagentEntries.sourcePath', this.lockFileName),
                    targetPath: this.normalizeRelativePath(entry.targetPath ?? '', 'lock.subagentEntries.targetPath', this.lockFileName),
                    sharedFiles: Helpers.sortUniq(
                        (Array.isArray(entry.sharedFiles) ? entry.sharedFiles : [])
                            .map((sharedFilePath: unknown) => this.normalizeRelativePath(
                                sharedFilePath,
                                'lock.subagentEntries.sharedFiles',
                                this.lockFileName,
                            )),
                    ),
                    hash: this.normalizeManagedFileHash(entry.hash, 'lock.subagentEntries.hash'),
                };
            })
            .filter((entry): entry is SubagentEntry => Boolean(entry));

        const unique = new Map<string, SubagentEntry>();
        normalized.forEach((entry) => {
            const key = entry.name.toLowerCase();
            if (unique.has(key)) {
                Helpers.die(`"${this.lockFileName}": duplicate subagent entry "${entry.name}"`);
            }
            unique.set(key, entry);
        });

        return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    public normalizeLockSharedEntries(entries: unknown): SharedEntry[] {
        if (!Array.isArray(entries)) {
            return [];
        }

        const normalized = entries
            .filter(entry => entry && typeof entry === 'object')
            .map((entry: UnknownRecord) => ({
                sourcePath: this.normalizeRelativePath(entry.sourcePath ?? '', 'lock.sharedEntries.sourcePath', this.lockFileName),
                targetPath: this.normalizeRelativePath(entry.targetPath ?? '', 'lock.sharedEntries.targetPath', this.lockFileName),
                hash: this.normalizeManagedFileHash(entry.hash, 'lock.sharedEntries.hash'),
                owners: this.normalizeOwners(entry.owners),
            }));

        const unique = new Map<string, SharedEntry>();
        normalized.forEach((entry) => {
            const existing = unique.get(entry.targetPath);
            if (existing) {
                if (JSON.stringify(existing) !== JSON.stringify(entry)) {
                    Helpers.die(`"${this.lockFileName}": duplicate shared entry targetPath "${entry.targetPath}"`);
                }
                return;
            }
            unique.set(entry.targetPath, entry);
        });

        return [...unique.values()].sort((a, b) => a.targetPath.localeCompare(b.targetPath));
    }

    public normalizeManagedFileHash(value: unknown, fieldName: string): ManagedFileHash {
        if (!value || typeof value !== 'object') {
            Helpers.die(`"${this.lockFileName}": "${fieldName}" must be an object`);
        }
        const hash = value as UnknownRecord;
        const sha256 = typeof hash.sha256 === 'string' ? hash.sha256.trim() : '';
        if (!sha256) {
            Helpers.die(`"${this.lockFileName}": "${fieldName}.sha256" must be a non-empty string`);
        }
        if (typeof hash.executable !== 'boolean') {
            Helpers.die(`"${this.lockFileName}": "${fieldName}.executable" must be boolean`);
        }
        return { sha256, executable: hash.executable };
    }

    private normalizeOwners(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }
        return Helpers.sortUniq(value
            .filter((owner: unknown): owner is string => typeof owner === 'string')
            .map(owner => owner.trim())
            .filter(Boolean));
    }

    private sharedEntriesFromLegacyHashes(hashes: FileHashEntry[], skillEntries: SkillEntry[]): SharedEntry[] {
        return hashes.map(entry => ({
            sourcePath: entry.path,
            targetPath: entry.path,
            hash: { sha256: entry.sha256, executable: false },
            owners: skillEntries
                .filter(skill => skill.sharedFiles.includes(entry.path))
                .map(skill => `skill:${skill.name}`)
                .sort((a, b) => a.localeCompare(b)),
        }));
    }

    public normalizeLockSkillHash(hash: unknown): SkillTreeHash | null {
        if (!hash || typeof hash !== 'object') {
            return null;
        }
        const normalizedHash = hash as UnknownRecord;

        const treeSha256 = typeof normalizedHash.treeSha256 === 'string' ? normalizedHash.treeSha256.trim() : '';
        if (!treeSha256) {
            return null;
        }

        const files = Array.isArray(normalizedHash.files)
            ? normalizedHash.files
                .filter((entry: unknown) => entry && typeof entry === 'object')
                .map((entry: UnknownRecord) => {
                    const relativePath = this.normalizeRelativePath(
                        entry.path ?? '',
                        'lock.skillEntries.hash.files.path',
                        this.lockFileName,
                    );
                    const sha256 = typeof entry.sha256 === 'string' ? entry.sha256.trim() : '';
                    if (!sha256) {
                        return null;
                    }

                    return { path: relativePath, sha256 };
                })
                .filter((value): value is { path: string; sha256: string } => Boolean(value))
            : [];

        return {
            treeSha256,
            files: files.sort((a, b) => a.path.localeCompare(b.path)),
        };
    }

    public normalizeLockSharedFileHashes(entries: unknown): FileHashEntry[] {
        if (!Array.isArray(entries)) {
            return [];
        }

        const unique = new Map<string, FileHashEntry>();
        entries.forEach((entry: unknown) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }
            const normalizedEntry = entry as UnknownRecord;

            const filePath = this.normalizeRelativePath(
                normalizedEntry.path ?? '',
                'lock.sharedFileHashes.path',
                this.lockFileName,
            );
            const sha256 = typeof normalizedEntry.sha256 === 'string' ? normalizedEntry.sha256.trim() : '';
            if (!sha256) {
                return;
            }

            if (!unique.has(filePath)) {
                unique.set(filePath, { path: filePath, sha256 });
            }
        });

        return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
    }

    public normalizeLockResolved(resolved: unknown): ResolvedSourceMeta {
        if (!resolved || typeof resolved !== 'object') {
            return {
                requestedRef: null,
                defaultBranch: null,
                resolvedRef: null,
                resolvedCommit: null,
                subpath: null,
                resolvedAt: null,
            };
        }
        const normalizedResolved = resolved as UnknownRecord;

        const normalizeNullableString = (value: unknown): string | null => {
            if (typeof value !== 'string') {
                return null;
            }
            const trimmed = value.trim();
            return trimmed ? trimmed : null;
        };

        return {
            requestedRef: normalizeNullableString(normalizedResolved.requestedRef),
            defaultBranch: normalizeNullableString(normalizedResolved.defaultBranch),
            resolvedRef: normalizeNullableString(normalizedResolved.resolvedRef),
            resolvedCommit: normalizeNullableString(normalizedResolved.resolvedCommit),
            subpath: normalizeNullableString(normalizedResolved.subpath),
            resolvedAt: normalizeNullableString(normalizedResolved.resolvedAt),
        };
    }

    public normalizeRelativePath(value: unknown, fieldName: string, sourceLabel = this.lockFileName): string {
        if (typeof value !== 'string') {
            Helpers.die(`"${sourceLabel}": "${fieldName}" must be a string`);
        }

        const normalizedSlashes = value.trim().replace(/\\/g, '/');
        if (!normalizedSlashes) {
            Helpers.die(`"${sourceLabel}": "${fieldName}" cannot be empty`);
        }

        if (normalizedSlashes.startsWith('/') || /^[A-Za-z]:\//.test(normalizedSlashes)) {
            Helpers.die(`"${sourceLabel}": "${fieldName}" must be a relative path`);
        }

        const tokens = normalizedSlashes
            .split('/')
            .filter(token => token.length > 0 && token !== '.');

        if (tokens.some(token => token === '..')) {
            Helpers.die(`"${sourceLabel}": "${fieldName}" cannot contain ".."`);
        }

        return tokens.length > 0 ? tokens.join('/') : '.';
    }
}
