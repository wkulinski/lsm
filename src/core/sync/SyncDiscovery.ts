import Helpers from '../shared/Helpers';
import type {
    BackendLike,
    DiscoveredSources,
    FileHashEntry,
    ManifestData,
    ResolvedSourceMeta,
    SkillEntry,
} from '../types';

interface ListedSkillsResult {
    skills: string[];
    skillEntries: SkillEntry[];
    sharedFileHashes: FileHashEntry[];
    aliasMap: Map<string, string>;
    listedAt: string;
    resolved: ResolvedSourceMeta;
}

export default class SyncDiscovery {
    private readonly backend: BackendLike;

    public constructor({ backend }: { backend: BackendLike }) {
        this.backend = backend;
    }

    public discover(manifest: ManifestData): { discovered: DiscoveredSources; missingRequested: { source: string; skill: string }[] } {
        const discovered: DiscoveredSources = {};
        const missingRequested: { source: string; skill: string }[] = [];

        manifest.sources.forEach(({ source, skills }) => {
            const listed = this.listSkillsOrDie(source, skills);
            const available = listed.skills;
            const aliasMap = listed.aliasMap;
            const listedAt = listed.listedAt;
            const skillEntries = listed.skillEntries;
            const sharedFileHashes = listed.sharedFileHashes;
            const resolved = listed.resolved;

            if (skills?.length) {
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
                    sharedFileHashes: sharedFileHashes.filter(entry => filteredSharedFiles.has(entry.path)),
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
                sharedFileHashes,
                missingRequested: [],
                resolved,
            };
        });

        return { discovered, missingRequested };
    }

    private listSkillsOrDie(source: string, skills: string[] | null): ListedSkillsResult {
        const listed = this.backend.listSkills(source, { includeInternal: !!(skills && skills.length > 0) });
        if (listed.ok) {
            return {
                skills: listed.skills,
                skillEntries: listed.skillEntries,
                sharedFileHashes: listed.sharedFileHashes,
                aliasMap: listed.aliasMap,
                listedAt: new Date().toISOString(),
                resolved: listed.resolved,
            };
        }

        throw Helpers.error(listed.error, listed.details ? listed.details.slice(0, 2000) : null);
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
