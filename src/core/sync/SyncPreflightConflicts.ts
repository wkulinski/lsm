import SyncPreflightConflictSet from './SyncPreflightConflictSet';
import SyncPreflightManagedPaths from './SyncPreflightManagedPaths';
import SyncPreflightSharedConflicts from './SyncPreflightSharedConflicts';
import SyncPreflightSkillConflicts from './SyncPreflightSkillConflicts';
import SyncPreflightUnmanagedConflicts from './SyncPreflightUnmanagedConflicts';
import SyncPathMapper from './SyncPathMapper';
import type {
    BackendLike,
    DiscoveredSources,
    LockData,
    ManifestData,
    SyncPlan,
    SyncPreflightConflict,
} from '../types';

interface SyncPreflightConflictsDependencies {
    pathMapper?: SyncPathMapper;
    managedPaths?: SyncPreflightManagedPaths;
    sharedConflicts?: SyncPreflightSharedConflicts;
    skillConflicts?: SyncPreflightSkillConflicts;
    unmanagedConflicts?: SyncPreflightUnmanagedConflicts;
}

export default class SyncPreflightConflicts {
    private readonly backend: BackendLike;
    private readonly pathMapper: SyncPathMapper;
    private readonly managedPaths: SyncPreflightManagedPaths;
    private readonly sharedConflicts: SyncPreflightSharedConflicts;
    private readonly skillConflicts: SyncPreflightSkillConflicts;
    private readonly unmanagedConflicts: SyncPreflightUnmanagedConflicts;

    public constructor({
        backend,
        pathMapper,
        managedPaths,
        sharedConflicts,
        skillConflicts,
        unmanagedConflicts,
    }: { backend: BackendLike } & SyncPreflightConflictsDependencies) {
        this.backend = backend;
        this.pathMapper = pathMapper ?? new SyncPathMapper({ backend });
        this.managedPaths = managedPaths ?? new SyncPreflightManagedPaths({ backend, pathMapper: this.pathMapper });
        this.sharedConflicts = sharedConflicts ?? new SyncPreflightSharedConflicts({ backend, pathMapper: this.pathMapper });
        this.skillConflicts = skillConflicts ?? new SyncPreflightSkillConflicts({ backend, pathMapper: this.pathMapper });
        this.unmanagedConflicts = unmanagedConflicts ?? new SyncPreflightUnmanagedConflicts({ backend, pathMapper: this.pathMapper });
    }

    public collectLocalChangeConflicts(
        { manifest, lock, discovered, plan }: { manifest: ManifestData; lock: LockData; discovered: DiscoveredSources; plan?: Partial<SyncPlan> },
    ): { ok: boolean; error?: string; conflicts: SyncPreflightConflict[] } {
        const currentDirsResult = this.backend.resolveAgentProjectSkillDirs(manifest.agents);
        if (!currentDirsResult.ok) {
            return { ok: false, error: currentDirsResult.error, conflicts: [] };
        }

        const unionAgents = Array.isArray(plan?.agentsUnion) && plan.agentsUnion.length > 0
            ? plan.agentsUnion
            : manifest.agents;
        const unionDirsResult = this.backend.resolveAgentProjectSkillDirs(unionAgents);
        const currentAgentSkillDirs = currentDirsResult.dirs;
        const allAgentSkillDirs = unionDirsResult.ok ? unionDirsResult.dirs : currentAgentSkillDirs;
        const currentDirSet = new Set(currentAgentSkillDirs);
        const removedSkills = new Set((plan?.skillsRemoved ?? []).map(skillName => skillName.toLowerCase()));

        const newManagedLocalPaths = this.managedPaths.collectNewManagedLocalPaths({
            discovered,
            currentAgentSkillDirs,
        });
        const newManagedPathSet = new Set([...newManagedLocalPaths.skillDirs, ...newManagedLocalPaths.sharedFiles]);

        const oldManagedPathSet = new Set<string>();
        const conflictSet = new SyncPreflightConflictSet();

        Object.entries(lock.sources).forEach(([source, sourceMeta]) => {
            const skillEntries = Array.isArray(sourceMeta.skillEntries) ? sourceMeta.skillEntries : [];
            const targetSourceMeta = Object.hasOwn(discovered, source)
                ? discovered[source]
                : null;
            const targetSkillEntries = targetSourceMeta && Array.isArray(targetSourceMeta.skillEntries)
                ? targetSourceMeta.skillEntries
                : [];
            const sourceSkillsRoot = this.pathMapper.resolveSourceSkillsRootPrefix(skillEntries);
            if (!sourceSkillsRoot.ok) {
                return;
            }

            skillEntries.forEach((entry) => {
                const relativePath = this.pathMapper.relativeToSkillsRoot(entry.sourcePath, sourceSkillsRoot.prefix);
                if (!relativePath) {
                    return;
                }

                allAgentSkillDirs.forEach((agentSkillDir) => {
                    this.skillConflicts.collectSkillDirectoryConflictsForAgent({
                        source,
                        entry,
                        targetEntry: targetSkillEntries.find(target => target.sourcePath === entry.sourcePath),
                        agentSkillDir,
                        relativePath,
                        removedSkills,
                        currentDirSet,
                        oldManagedPathSet,
                        conflictSet,
                    });
                });
            });

            this.sharedConflicts.collectSharedFileConflictsForSource({
                source,
                skillEntries,
                targetSkillEntries,
                baselineSharedFileHashes: sourceMeta.sharedFileHashes,
                targetSharedFileHashes: targetSourceMeta ? targetSourceMeta.sharedFileHashes : [],
                sourceSkillsRootPrefix: sourceSkillsRoot.prefix,
                allAgentSkillDirs,
                currentDirSet,
                newManagedPathSet,
                oldManagedPathSet,
                conflictSet,
            });
        });

        this.unmanagedConflicts.collectUnmanagedExistingPathConflicts({
            newManagedPathSet,
            oldManagedPathSet,
            conflictSet,
        });

        return {
            ok: true,
            conflicts: conflictSet.toSortedArray(),
        };
    }
}
