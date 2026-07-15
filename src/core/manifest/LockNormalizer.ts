import Helpers from '../shared/Helpers';
import { formatUnknown } from '../utils/formatUnknown';
import type {
    FileHashEntry,
    LockData,
    LockSourceMeta,
    ResolvedSourceMeta,
    SkillEntry,
    SkillTreeHash,
} from '../types';

export const LOCK_SCHEMA_VERSION = 5;

interface UnknownRecord { [key: string]: unknown }

export default class LockNormalizer {
    private readonly lockFileName: string;

    public constructor({ lockFileName }: { lockFileName: string }) {
        this.lockFileName = lockFileName;
    }

    public emptyLock(): LockData {
        return { schemaVersion: LOCK_SCHEMA_VERSION, agents: [], sources: {} };
    }

    public normalize(json: unknown): LockData {
        const record = json as UnknownRecord;
        if (record.schemaVersion !== LOCK_SCHEMA_VERSION) {
            Helpers.die(
                `"${this.lockFileName}": unsupported schemaVersion=${formatUnknown(record.schemaVersion)}; expected ${String(LOCK_SCHEMA_VERSION)}`,
            );
        }
        const agents = Array.isArray(record.agents) ? record.agents.map(String).map(s => s.trim()).filter(Boolean) : [];
        const sources = this.normalizeLockSources(record.sources);

        return {
            schemaVersion: LOCK_SCHEMA_VERSION,
            agents: Helpers.sortUniq(agents),
            sources,
        };
    }

    public normalizeLockSources(rawSources: unknown): { [key: string]: LockSourceMeta } {
        if (!rawSources || typeof rawSources !== 'object') {
            return {};
        }

        return Object.fromEntries(
            Object.entries(rawSources).map(([source, meta]) => {
                const normalizedMeta: UnknownRecord = meta && typeof meta === 'object' ? meta as UnknownRecord : {};

                return [source, {
                    mode: typeof normalizedMeta.mode === 'string' ? normalizedMeta.mode : 'all',
                    listedAt: typeof normalizedMeta.listedAt === 'string' ? normalizedMeta.listedAt : null,
                    skillEntries: this.normalizeLockSkillEntries(normalizedMeta.skillEntries),
                    sharedFileHashes: this.normalizeLockSharedFileHashes(normalizedMeta.sharedFileHashes),
                    resolved: this.normalizeLockResolved(normalizedMeta.resolved),
                }];
            }),
        );
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
