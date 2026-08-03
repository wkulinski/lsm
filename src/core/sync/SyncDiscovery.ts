import Helpers from '../shared/Helpers';
import type {
    BackendLike,
    DiscoveredSources,
    FileHashEntry,
    LockData,
    ManifestData,
    ResolvedSourceMeta,
    SkillEntry,
    ManagedFileHashEntry,
    SourceDiscoverySuccess,
    SubagentEntry,
} from '../types';

interface ListedSkillsResult {
    skills: string[];
    skillEntries: SkillEntry[];
    sharedFileHashes: FileHashEntry[];
    managedSharedFileHashes?: ManagedFileHashEntry[];
    aliasMap: Map<string, string>;
    listedAt: string;
    resolved: ResolvedSourceMeta;
    subagents: SourceDiscoverySuccess['subagents'];
    subagentSharedFiles: SourceDiscoverySuccess['subagentSharedFiles'];
}

export default class SyncDiscovery {
    private readonly backend: BackendLike;

    public constructor({ backend }: { backend: BackendLike }) {
        this.backend = backend;
    }

    public discover(manifest: ManifestData, { update = true, lock }: { update?: boolean; lock?: LockData } = {}): { discovered: DiscoveredSources; missingRequested: { source: string; skill: string }[] } {
        const discovered: DiscoveredSources = {};
        const missingRequested: { source: string; skill: string }[] = [];

        manifest.sources.forEach(({ source, skills, subagents }) => {
            const resolvedCommit = update ? null : lock?.sources[source]?.resolved.resolvedCommit ?? null;
            const activeSubagentSelection = (manifest.subagents ?? []).length > 0 ? subagents : [];
            const lockedSubagentEntries = lock?.sources[source]?.subagentEntries ?? [];
            const listed = this.listSourceOrDie({
                source,
                skills,
                subagents: activeSubagentSelection ?? null,
                mode: update ? 'update' : 'locked',
                resolvedCommit,
                lockedSubagentEntries,
            });
            const available = listed.skills;
            const aliasMap = listed.aliasMap;
            const listedAt = listed.listedAt;
            const skillEntries = listed.skillEntries;
            const sharedFileHashes = listed.sharedFileHashes;
            const managedSharedFileHashes = listed.managedSharedFileHashes;
            const skillSharedFileHashes = manifest.agents.length > 0 ? sharedFileHashes : [];
            const skillManagedSharedFileHashes = manifest.agents.length > 0 ? managedSharedFileHashes : [];
            const resolved = listed.resolved;
            const discoveredSubagents = listed.subagents;
            const subagentSharedFiles = listed.subagentSharedFiles;

            if (skills !== null) {
                const { desired, missing } = this.resolveDesiredSkills(skills, aliasMap);
                const desiredUniq = Helpers.sortUniq(desired);
                const desiredSet = new Set(desiredUniq.map(name => name.toLowerCase()));
                const filteredSkillEntries = skillEntries.filter(entry => desiredSet.has(entry.name.toLowerCase()));
                const filteredSharedFiles = new Set(
                    filteredSkillEntries.flatMap(entry => Array.isArray(entry.sharedFiles) ? entry.sharedFiles : []),
                );
                missing.forEach(skill => missingRequested.push({ source, skill }));
                discovered[source] = {
                    mode: 'explicit',
                    listedAt,
                    skills: desiredUniq,
                    skillEntries: filteredSkillEntries,
                    sharedFileHashes: skillSharedFileHashes.filter(entry => filteredSharedFiles.has(entry.path)),
                    managedSharedFileHashes: skillManagedSharedFileHashes?.filter(entry => filteredSharedFiles.has(entry.path)),
                    subagents: discoveredSubagents,
                    subagentSharedFiles,
                    missingRequested: missing,
                    resolved,
                };
                return;
            }

            discovered[source] = {
                mode: 'all',
                listedAt,
                skills: available,
                skillEntries,
                sharedFileHashes: skillSharedFileHashes,
                managedSharedFileHashes: skillManagedSharedFileHashes,
                subagents: discoveredSubagents,
                subagentSharedFiles,
                missingRequested: [],
                resolved,
            };
        });

        return { discovered, missingRequested };
    }

    private listSkillsOrDie(source: string, skills: string[] | null, resolvedCommit: string | null): ListedSkillsResult {
        const options: { includeInternal: boolean; resolvedCommit?: string } = {
            includeInternal: !!(skills && skills.length > 0),
        };
        if (resolvedCommit) {
            options.resolvedCommit = resolvedCommit;
        }
        const listed = this.backend.listSkills(source, options);
        if (listed.ok) {
            return {
                skills: listed.skills,
                skillEntries: listed.skillEntries,
                sharedFileHashes: listed.sharedFileHashes,
                managedSharedFileHashes: listed.managedSharedFileHashes,
                aliasMap: listed.aliasMap,
                listedAt: new Date().toISOString(),
                resolved: listed.resolved,
                subagents: [],
                subagentSharedFiles: [],
            };
        }

        throw Helpers.error(listed.error, listed.details ? listed.details.slice(0, 2000) : null);
    }

    private listSourceOrDie({
        source,
        skills,
        subagents,
        mode,
        resolvedCommit,
        lockedSubagentEntries,
    }: {
        source: string;
        skills: string[] | null;
        subagents: string[] | null;
        mode: 'update' | 'locked';
        resolvedCommit: string | null;
        lockedSubagentEntries: SubagentEntry[];
    }): ListedSkillsResult {
        if (typeof this.backend.discoverSource !== 'function') {
            const listed = this.listSkillsOrDie(source, skills, resolvedCommit);
            return { ...listed, subagents: [], subagentSharedFiles: [] };
        }

        const listed = this.backend.discoverSource(source, {
            skills,
            subagents,
            mode,
            resolvedCommit,
            lockedSubagentEntries,
        });
        if (!listed.ok) {
            throw Helpers.error(listed.error, listed.details ? listed.details.slice(0, 2000) : null);
        }

        return listed;
    }

    private resolveDesiredSkills(skills: string[], aliasMap: Map<string, string>): { desired: string[]; missing: string[] } {
        const desired: string[] = [];
        const missing: string[] = [];

        skills.forEach((skillName) => {
            const resolved = aliasMap.get(skillName.toLowerCase());
            if (!resolved) {
                missing.push(skillName);
                return;
            }
            desired.push(resolved);
        });

        return { desired, missing };
    }
}
