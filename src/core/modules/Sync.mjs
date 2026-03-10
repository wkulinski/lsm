import fs from "node:fs";
import path from "node:path";

import Helpers from "./Helpers.mjs";
import Hashing from "./Hashing.mjs";

export default class Sync {
    constructor({ backend, manifestStore }) {
        this.backend = backend;
        this.manifestStore = manifestStore;
    }

    discover(manifest) {
        const discovered = {};
        const missingRequested = [];

        manifest.sources.forEach(({ source, skills }) => {
            const listed = this._listSkillsOrDie(source, skills);
            const available = listed.skills;
            const aliasMap = listed.aliasMap;
            const listedAt = listed.listedAt;
            const skillEntries = listed.skillEntries;
            const sharedFileHashes = listed.sharedFileHashes;
            const resolved = listed.resolved;

            if (skills?.length) {
                const { desired, missing } = this._resolveDesiredSkills(skills, aliasMap);
                const desiredUniq = Helpers.sortUniq(desired);
                const desiredSet = new Set(desiredUniq.map((name) => name.toLowerCase()));
                const filteredSkillEntries = skillEntries.filter((entry) => desiredSet.has(entry.name.toLowerCase()));
                const filteredSharedFiles = new Set(
                    filteredSkillEntries.flatMap((entry) => Array.isArray(entry.sharedFiles) ? entry.sharedFiles : [])
                );
                missing.forEach((m) => missingRequested.push({ source, skill: m }));
                discovered[source] = {
                    mode: "explicit",
                    listedAt,
                    skills: desiredUniq,
                    skillEntries: filteredSkillEntries,
                    sharedFileHashes: (sharedFileHashes ?? []).filter((entry) => filteredSharedFiles.has(entry.path)),
                    missingRequested: missing,
                    resolved,
                };
                return;
            }

            discovered[source] = {
                mode: "all",
                listedAt,
                skills: available,
                skillEntries,
                sharedFileHashes: sharedFileHashes ?? [],
                missingRequested: [],
                resolved,
            };
        });

        return { discovered, missingRequested };
    }

    _listSkillsOrDie(source, skills) {
        const listed = this.backend.listSkills(source, { includeInternal: !!(skills && skills.length > 0) });
        if (listed.ok) {
            return {
                skills: listed.skills,
                skillEntries: listed.skillEntries ?? [],
                sharedFileHashes: listed.sharedFileHashes ?? [],
                aliasMap: listed.aliasMap ?? new Map(),
                listedAt: new Date().toISOString(),
                resolved: listed.resolved ?? {
                    requestedRef: null,
                    defaultBranch: null,
                    resolvedRef: null,
                    resolvedCommit: null,
                    subpath: null,
                    resolvedAt: null,
                },
            };
        }

        throw Helpers.error(listed.error, listed.details ? String(listed.details).slice(0, 2000) : null);
    }

    _resolveDesiredSkills(skills, aliasMap) {
        const desired = [];
        const missing = [];

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

    assertNoConflicts(discovered) {
        const skillToSource = new Map();
        const conflicts = [];

        Object.entries(discovered).forEach(([src, meta]) => {
            meta.skills.forEach((skill) => {
                const prev = skillToSource.get(skill);
                if (prev && prev !== src) { conflicts.push({ skill, a: prev, b: src }); }
                else { skillToSource.set(skill, src); }
            });
        });

        if (conflicts.length) {
            throw Helpers.error("Skill name conflicts detected.", conflicts);
        }
    }

    planRemovals({ lock, manifest, discovered }) {
        const oldAgents = lock.agents ?? [];
        const newAgents = manifest.agents;
        const agentsUnion = Helpers.sortUniq([...oldAgents, ...newAgents]);
        const agentsRemoved = oldAgents.filter((a) => !newAgents.includes(a));

        const oldManaged = this.manifestStore.lockManagedSkills(lock.sources);
        const newManaged = Helpers.sortUniq(Object.values(discovered).flatMap((x) => x.skills));

        const newSet = new Set(newManaged);
        // Intencjonalnie: usuwamy też skille, które zniknęły upstream (synchronizacja ze źródłem).
        const skillsRemoved = oldManaged.filter((s) => !newSet.has(s)); // prune missing + config removals

        return { oldAgents, newAgents, agentsUnion, agentsRemoved, oldManaged, newManaged, skillsRemoved };
    }

    collectLocalChangeConflicts({ manifest, lock, discovered, plan }) {
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
        const removedSkills = new Set((plan?.skillsRemoved ?? []).map((skillName) => skillName.toLowerCase()));

        const newManagedLocalPaths = this._collectNewManagedLocalPaths({
            discovered,
            currentAgentSkillDirs,
        });
        const newManagedPathSet = new Set([...newManagedLocalPaths.skillDirs, ...newManagedLocalPaths.sharedFiles]);

        const oldManagedPathSet = new Set();
        const conflicts = [];
        const conflictKeys = new Set();

        Object.entries(lock.sources ?? {}).forEach(([source, sourceMeta]) => {
            const skillEntries = Array.isArray(sourceMeta?.skillEntries) ? sourceMeta.skillEntries : [];
            const sourceSkillsRoot = this._resolveSourceSkillsRootPrefix(skillEntries);
            if (!sourceSkillsRoot.ok) {
                return;
            }

            skillEntries.forEach((entry) => {
                const relativePath = this._relativeToSkillsRoot(entry?.sourcePath, sourceSkillsRoot.prefix);
                if (!relativePath) {
                    return;
                }

                allAgentSkillDirs.forEach((agentSkillDir) => {
                    this._collectSkillDirectoryConflictsForAgent({
                        source,
                        entry,
                        agentSkillDir,
                        relativePath,
                        removedSkills,
                        currentDirSet,
                        oldManagedPathSet,
                        conflicts,
                        conflictKeys,
                    });
                });
            });

            const sourceSharedFileHashes = Array.isArray(sourceMeta?.sharedFileHashes)
                ? sourceMeta.sharedFileHashes
                : [];
            const sourceSharedFileHashMap = new Map(
                sourceSharedFileHashes
                    .map((entry) => [String(entry?.path ?? "").trim(), String(entry?.sha256 ?? "").trim()])
                    .filter(([filePath, sha256]) => filePath && sha256)
            );
            const sourceSharedFiles = sourceSharedFileHashMap.size > 0
                ? [...sourceSharedFileHashMap.keys()]
                : this._collectSharedFilesFromSkillEntries(skillEntries);

            sourceSharedFiles.forEach((sourceSharedFilePath) => {
                const relativePath = this._relativeToSkillsRoot(sourceSharedFilePath, sourceSkillsRoot.prefix);
                if (!relativePath) {
                    return;
                }

                allAgentSkillDirs.forEach((agentSkillDir) => {
                    const localSharedFilePath = path.resolve(agentSkillDir, relativePath);
                    if (!this._isPathInsideRoot(localSharedFilePath)) {
                        return;
                    }

                    const localSharedFileRelative = this._toProjectRelativePath(localSharedFilePath);
                    oldManagedPathSet.add(localSharedFileRelative);

                    if (!fs.existsSync(localSharedFilePath)) {
                        return;
                    }

                    const operation = currentDirSet.has(agentSkillDir) && newManagedPathSet.has(localSharedFileRelative)
                        ? "overwrite"
                        : "delete";
                    const baselineSha = sourceSharedFileHashMap.get(sourceSharedFilePath);

                    if (!baselineSha) {
                        this._addConflict(conflicts, conflictKeys, {
                            path: localSharedFileRelative,
                            reason: "missing-baseline-hash",
                            operation,
                            scope: "shared",
                            source,
                            skill: null,
                        });
                        return;
                    }

                    const stat = fs.statSync(localSharedFilePath);
                    if (!stat.isFile()) {
                        this._addConflict(conflicts, conflictKeys, {
                            path: localSharedFileRelative,
                            reason: "modified-managed",
                            operation,
                            scope: "shared",
                            source,
                            skill: null,
                        });
                        return;
                    }

                    const currentSha = Hashing.sha256File(localSharedFilePath);
                    if (currentSha !== baselineSha) {
                        this._addConflict(conflicts, conflictKeys, {
                            path: localSharedFileRelative,
                            reason: "modified-managed",
                            operation,
                            scope: "shared",
                            source,
                            skill: null,
                        });
                    }
                });
            });
        });

        newManagedPathSet.forEach((localPath) => {
            if (oldManagedPathSet.has(localPath)) {
                return;
            }

            const absolutePath = path.resolve(this.backend.root, localPath);
            if (!this._isPathInsideRoot(absolutePath)) {
                return;
            }
            if (!fs.existsSync(absolutePath)) {
                return;
            }

            const stat = fs.statSync(absolutePath);
            if (stat.isDirectory()) {
                const currentHash = Hashing.hashDirectory(absolutePath);
                if (!currentHash || currentHash.files.length === 0) {
                    return;
                }
            } else if (!stat.isFile()) {
                return;
            }

            this._addConflict(conflicts, conflictKeys, {
                path: localPath,
                reason: "unmanaged-existing-path",
                operation: "overwrite",
                scope: stat.isDirectory() ? "skill" : "shared",
                source: null,
                skill: null,
            });
        });

        return {
            ok: true,
            conflicts: conflicts.sort((a, b) => a.path.localeCompare(b.path)),
        };
    }

    _collectSkillDirectoryConflictsForAgent({
        source,
        entry,
        agentSkillDir,
        relativePath,
        removedSkills,
        currentDirSet,
        oldManagedPathSet,
        conflicts,
        conflictKeys,
    }) {
        const localSkillDir = path.resolve(agentSkillDir, relativePath);
        if (!this._isPathInsideRoot(localSkillDir)) {
            return;
        }

        const localSkillDirRelative = this._toProjectRelativePath(localSkillDir);
        oldManagedPathSet.add(localSkillDirRelative);

        if (!fs.existsSync(localSkillDir) || !fs.statSync(localSkillDir).isDirectory()) {
            return;
        }

        const operation = removedSkills.has(String(entry?.name ?? "").toLowerCase()) || !currentDirSet.has(agentSkillDir)
            ? "delete"
            : "overwrite";
        const baselineHash = this._normalizeSkillBaselineHash(entry?.hash);
        if (!baselineHash) {
            this._addConflict(conflicts, conflictKeys, {
                path: localSkillDirRelative,
                reason: "missing-baseline-hash",
                operation,
                scope: "skill",
                source,
                skill: entry?.name ?? null,
            });
            return;
        }

        const currentHash = Hashing.hashDirectory(localSkillDir);
        if (!currentHash || currentHash.treeSha256 === baselineHash.treeSha256) {
            return;
        }

        const changedFiles = this._diffHashedFiles(baselineHash.files, currentHash.files);
        if (changedFiles.length === 0) {
            this._addConflict(conflicts, conflictKeys, {
                path: localSkillDirRelative,
                reason: "modified-managed",
                operation,
                scope: "skill",
                source,
                skill: entry?.name ?? null,
            });
            return;
        }

        changedFiles.forEach((changedFile) => {
            const absoluteChangedPath = path.resolve(localSkillDir, changedFile);
            if (!this._isPathInsideRoot(absoluteChangedPath)) {
                return;
            }

            this._addConflict(conflicts, conflictKeys, {
                path: this._toProjectRelativePath(absoluteChangedPath),
                reason: "modified-managed",
                operation,
                scope: "skill-file",
                source,
                skill: entry?.name ?? null,
            });
        });
    }

    _normalizeSkillBaselineHash(hash) {
        if (!hash || typeof hash !== "object") {
            return null;
        }
        if (!hash.treeSha256 || !Array.isArray(hash.files)) {
            return null;
        }

        return hash;
    }

    removePhase(plan) {
        const { agentsRemoved, oldManaged, agentsUnion, skillsRemoved } = plan;
        const summary = {
            removedFromRemovedAgents: oldManaged.length,
            prunedSkills: skillsRemoved.length,
            removedAgents: agentsRemoved,
            agentsUnion,
            hadNothingToPrune: !(skillsRemoved.length && agentsUnion.length),
        };

        if (agentsRemoved.length && oldManaged.length) {
            this._chunk(oldManaged, 25).forEach((g) => {
                const res = this.backend.removeSkills({ skills: g, agents: agentsRemoved });
                if (!res.ok) {
                    throw Helpers.error("Failed while removing managed skills from removed agents.", {
                        status: res.status,
                        cmd: res.cmd,
                    });
                }
            });
        }

        if (skillsRemoved.length && agentsUnion.length) {
            this._chunk(skillsRemoved, 25).forEach((g) => {
                const res = this.backend.removeSkills({ skills: g, agents: agentsUnion });
                if (!res.ok) {
                    throw Helpers.error("Failed while pruning removed or missing skills.", {
                        status: res.status,
                        cmd: res.cmd,
                    });
                }
            });
        }

        return summary;
    }

    addPhase(discovered, agents) {
        const installs = [];
        let addFailed = false;

        Object.entries(discovered).forEach(([source, meta]) => {
            const desired = meta.skills;

            if (!desired.length) {
                installs.push({ source, ok: true, skipped: true });
                return;
            }

            const res = meta.mode === "all"
                ? this.backend.addAllFromSource({ source, agents })
                : this.backend.addSelected({ source, skills: desired, agents });

            installs.push({ source, ...res });
            if (!res.ok) { addFailed = true; }
        });

        return { installs, addFailed };
    }

    syncSharedFilesPhase({ manifest, lock, discovered }) {
        const managedOldSourcePaths = this.manifestStore.lockManagedSharedFilesBySource(lock.sources);
        const managedOldLocalPaths = {};
        const managedNewLocalPaths = {};
        const sharedFileHashesBySource = {};
        const sharedStats = {};
        const errors = [];
        let sharedFailed = false;

        const dirsResult = this.backend.resolveAgentProjectSkillDirs(manifest.agents);
        if (!dirsResult.ok) {
            return {
                sharedFailed: true,
                managedNewLocalPaths: {},
                sharedStats: {},
                sharedFileHashesBySource: {},
                errors: [{ message: dirsResult.error }],
            };
        }

        Object.entries(lock.sources ?? {}).forEach(([source, sourceMeta]) => {
            managedOldLocalPaths[source] = this._mapSourceSharedFilesToLocalPaths({
                sourcePaths: managedOldSourcePaths[source] ?? [],
                sourceMeta,
                agentSkillDirs: dirsResult.dirs,
            });
        });

        Object.entries(discovered).forEach(([source, meta]) => {
            const sourceSharedFiles = this._collectSharedFilesFromSkillEntries(meta.skillEntries);
            let copiedFiles = 0;

            if (!sourceSharedFiles.length) {
                managedNewLocalPaths[source] = [];
                sharedFileHashesBySource[source] = [];
                sharedStats[source] = { declaredFiles: 0, copiedFiles: 0 };
                return;
            }

            const sourceSkillsRoot = this._resolveSourceSkillsRootPrefix(meta.skillEntries);
            if (!sourceSkillsRoot.ok) {
                errors.push({
                    source,
                    message: "Error while resolving shared files root for source.",
                    details: sourceSkillsRoot.error,
                });
                sharedFailed = true;
                managedNewLocalPaths[source] = [];
                sharedFileHashesBySource[source] = [];
                sharedStats[source] = { declaredFiles: sourceSharedFiles.length, copiedFiles: 0 };
                return;
            }

            const collected = this.backend.collectSharedFiles(source, sourceSharedFiles);
            if (!collected.ok) {
                errors.push({
                    source,
                    message: "Error while collecting shared files for source.",
                    details: collected.details ? String(collected.details).slice(0, 2000) : collected.error,
                });
                sharedFailed = true;
                managedNewLocalPaths[source] = [];
                sharedFileHashesBySource[source] = [];
                sharedStats[source] = { declaredFiles: sourceSharedFiles.length, copiedFiles: 0 };
                return;
            }

            sharedFileHashesBySource[source] = collected.files
                .map((fileEntry) => ({
                    path: String(fileEntry.path).trim(),
                    sha256: Hashing.sha256Buffer(fileEntry.content),
                }))
                .sort((a, b) => a.path.localeCompare(b.path));

            const managedFiles = new Set();
            dirsResult.dirs.forEach((agentSkillDir) => {
                collected.files.forEach((fileEntry) => {
                    const relativeToSkillsRoot = this._relativeToSkillsRoot(fileEntry.path, sourceSkillsRoot.prefix);
                    if (!relativeToSkillsRoot) {
                        errors.push({
                            source,
                            message: "Shared file path does not match source skills root.",
                            details: `${sourceSkillsRoot.prefix}: ${fileEntry.path}`,
                        });
                        sharedFailed = true;
                        return;
                    }

                    const destinationPath = path.resolve(agentSkillDir, relativeToSkillsRoot);
                    if (!this._isPathInsideRoot(destinationPath)) {
                        errors.push({
                            source,
                            message: "Shared file destination escapes project root.",
                            details: destinationPath,
                        });
                        sharedFailed = true;
                        return;
                    }

                    const relativeToProject = this._toProjectRelativePath(destinationPath);
                    this._ensureParentDirectory(destinationPath);
                    fs.writeFileSync(destinationPath, fileEntry.content);
                    managedFiles.add(relativeToProject);
                    copiedFiles += 1;
                });
            });

            managedNewLocalPaths[source] = Helpers.sortUniq([...managedFiles]);
            sharedStats[source] = {
                declaredFiles: sourceSharedFiles.length,
                copiedFiles,
            };
        });

        const conflicts = this._detectOwnershipConflicts(managedNewLocalPaths);
        if (conflicts.length) {
            return {
                sharedFailed: true,
                managedNewLocalPaths,
                sharedStats,
                sharedFileHashesBySource,
                errors: [{
                    message: "Shared file ownership conflicts detected.",
                    details: conflicts,
                }],
            };
        }

        if (sharedFailed) {
            return {
                sharedFailed: true,
                managedNewLocalPaths,
                sharedStats,
                sharedFileHashesBySource,
                errors,
            };
        }

        const removedFiles = this._pruneStaleManagedFiles(managedOldLocalPaths, managedNewLocalPaths);

        return {
            sharedFailed: false,
            managedNewLocalPaths,
            sharedStats,
            sharedFileHashesBySource,
            removedFiles,
            errors: [],
        };
    }

    _pruneStaleManagedFiles(managedOld, managedNew) {
        const allNewPaths = new Set(Object.values(managedNew).flatMap((files) => files));
        const sources = Helpers.sortUniq([...Object.keys(managedOld), ...Object.keys(managedNew)]);
        let removedFiles = 0;

        sources.forEach((source) => {
            const oldFiles = new Set(managedOld[source] ?? []);
            const newFiles = new Set(managedNew[source] ?? []);

            oldFiles.forEach((filePath) => {
                if (newFiles.has(filePath)) {
                    return;
                }
                if (allNewPaths.has(filePath)) {
                    return;
                }

                const absolutePath = path.resolve(this.backend.root, filePath);
                if (!this._isPathInsideRoot(absolutePath)) {
                    return;
                }
                if (!fs.existsSync(absolutePath)) {
                    return;
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) {
                    return;
                }

                fs.rmSync(absolutePath, { force: true });
                this._cleanupEmptyParents(path.dirname(absolutePath));
                removedFiles += 1;
            });
        });

        return removedFiles;
    }

    _detectOwnershipConflicts(filesBySource) {
        const owners = new Map();
        const conflicts = [];

        Object.entries(filesBySource).forEach(([source, files]) => {
            files.forEach((filePath) => {
                const previousOwner = owners.get(filePath);
                if (previousOwner && previousOwner !== source) {
                    conflicts.push({ filePath, a: previousOwner, b: source });
                    return;
                }
                owners.set(filePath, source);
            });
        });

        return conflicts;
    }

    _collectSharedFilesFromSkillEntries(skillEntries) {
        return Helpers.sortUniq(
            (Array.isArray(skillEntries) ? skillEntries : [])
                .flatMap((entry) => (Array.isArray(entry?.sharedFiles) ? entry.sharedFiles : []))
                .map((entry) => String(entry).trim())
                .filter(Boolean)
        );
    }

    _collectNewManagedLocalPaths({ discovered, currentAgentSkillDirs }) {
        const managedSkillDirs = new Set();
        const managedSharedFiles = new Set();

        Object.values(discovered ?? {}).forEach((meta) => {
            const skillEntries = Array.isArray(meta?.skillEntries) ? meta.skillEntries : [];
            const sourceSkillsRoot = this._resolveSourceSkillsRootPrefix(skillEntries);
            if (!sourceSkillsRoot.ok) {
                return;
            }

            skillEntries.forEach((entry) => {
                const relativePath = this._relativeToSkillsRoot(entry?.sourcePath, sourceSkillsRoot.prefix);
                if (!relativePath) {
                    return;
                }

                currentAgentSkillDirs.forEach((agentSkillDir) => {
                    const localSkillDir = path.resolve(agentSkillDir, relativePath);
                    if (!this._isPathInsideRoot(localSkillDir)) {
                        return;
                    }

                    managedSkillDirs.add(this._toProjectRelativePath(localSkillDir));
                });
            });

            const sharedFiles = this._collectSharedFilesFromSkillEntries(skillEntries);
            sharedFiles.forEach((sourceSharedFilePath) => {
                const relativePath = this._relativeToSkillsRoot(sourceSharedFilePath, sourceSkillsRoot.prefix);
                if (!relativePath) {
                    return;
                }

                currentAgentSkillDirs.forEach((agentSkillDir) => {
                    const localSharedFilePath = path.resolve(agentSkillDir, relativePath);
                    if (!this._isPathInsideRoot(localSharedFilePath)) {
                        return;
                    }

                    managedSharedFiles.add(this._toProjectRelativePath(localSharedFilePath));
                });
            });
        });

        return {
            skillDirs: managedSkillDirs,
            sharedFiles: managedSharedFiles,
        };
    }

    _diffHashedFiles(previousFiles, currentFiles) {
        const previousByPath = new Map(
            (Array.isArray(previousFiles) ? previousFiles : [])
                .filter((entry) => entry && typeof entry === "object")
                .map((entry) => [String(entry.path ?? "").trim(), String(entry.sha256 ?? "").trim()])
                .filter(([filePath]) => filePath)
        );
        const currentByPath = new Map(
            (Array.isArray(currentFiles) ? currentFiles : [])
                .filter((entry) => entry && typeof entry === "object")
                .map((entry) => [String(entry.path ?? "").trim(), String(entry.sha256 ?? "").trim()])
                .filter(([filePath]) => filePath)
        );

        const changed = new Set();
        [...previousByPath.keys(), ...currentByPath.keys()].forEach((filePath) => {
            if (previousByPath.get(filePath) !== currentByPath.get(filePath)) {
                changed.add(filePath);
            }
        });

        return Helpers.sortUniq([...changed]);
    }

    _addConflict(conflicts, keys, conflict) {
        const normalizedPath = String(conflict?.path ?? "").trim();
        const normalizedReason = String(conflict?.reason ?? "").trim();
        if (!normalizedPath || !normalizedReason) {
            return;
        }

        const key = `${normalizedPath}\0${normalizedReason}`;
        if (keys.has(key)) {
            return;
        }

        keys.add(key);
        conflicts.push({
            path: normalizedPath,
            reason: normalizedReason,
            operation: String(conflict?.operation ?? "overwrite"),
            scope: String(conflict?.scope ?? "unknown"),
            source: conflict?.source ?? null,
            skill: conflict?.skill ?? null,
        });
    }

    _resolveSourceSkillsRootPrefix(skillEntries) {
        const prefixes = Helpers.sortUniq(
            (Array.isArray(skillEntries) ? skillEntries : [])
                .map((entry) => this._extractSkillsRootPrefix(entry?.sourcePath))
                .filter(Boolean)
        );

        if (prefixes.length === 0) {
            return { ok: false, error: "Cannot infer source skills root from skillEntries." };
        }
        if (prefixes.length > 1) {
            return { ok: false, error: `Multiple skills roots detected: ${prefixes.join(", ")}` };
        }

        return { ok: true, prefix: prefixes[0] };
    }

    _extractSkillsRootPrefix(sourcePath) {
        const normalized = String(sourcePath ?? "").trim().replace(/\\/g, "/");
        if (!normalized) {
            return null;
        }

        const parts = normalized.split("/").filter(Boolean);
        const index = parts.lastIndexOf("skills");
        if (index === -1) {
            return null;
        }

        return parts.slice(0, index + 1).join("/");
    }

    _relativeToSkillsRoot(sourcePath, skillsRootPrefix) {
        const normalizedPath = String(sourcePath ?? "").trim().replace(/\\/g, "/");
        const normalizedRoot = String(skillsRootPrefix ?? "").trim().replace(/\\/g, "/");
        if (!normalizedPath || !normalizedRoot) {
            return null;
        }

        const prefix = `${normalizedRoot}/`;
        if (!normalizedPath.startsWith(prefix)) {
            return null;
        }

        const relativePath = normalizedPath.slice(prefix.length);
        return relativePath || null;
    }

    _mapSourceSharedFilesToLocalPaths({ sourcePaths, sourceMeta, agentSkillDirs }) {
        const rootResult = this._resolveSourceSkillsRootPrefix(sourceMeta?.skillEntries ?? []);
        if (!rootResult.ok) {
            return [];
        }

        const mapped = new Set();
        (Array.isArray(sourcePaths) ? sourcePaths : []).forEach((sourcePath) => {
            const relativeToSkillsRoot = this._relativeToSkillsRoot(sourcePath, rootResult.prefix);
            if (!relativeToSkillsRoot) {
                return;
            }

            agentSkillDirs.forEach((agentSkillDir) => {
                const destinationPath = path.resolve(agentSkillDir, relativeToSkillsRoot);
                if (!this._isPathInsideRoot(destinationPath)) {
                    return;
                }

                mapped.add(this._toProjectRelativePath(destinationPath));
            });
        });

        return Helpers.sortUniq([...mapped]);
    }

    _toProjectRelativePath(absolutePath) {
        const relative = path.relative(this.backend.root, absolutePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error(`Path escapes project root: ${absolutePath}`);
        }
        return relative.split(path.sep).join("/");
    }

    _isPathInsideRoot(absolutePath) {
        const relative = path.relative(this.backend.root, absolutePath);
        return !(relative.startsWith("..") || path.isAbsolute(relative));
    }

    _ensureParentDirectory(filePath) {
        const parent = path.dirname(filePath);
        if (!fs.existsSync(parent)) {
            fs.mkdirSync(parent, { recursive: true });
        }
    }

    _cleanupEmptyParents(startDirectoryPath) {
        let currentDirectoryPath = path.resolve(startDirectoryPath);
        const projectRoot = path.resolve(this.backend.root);

        while (currentDirectoryPath.startsWith(projectRoot) && currentDirectoryPath !== projectRoot) {
            if (!fs.existsSync(currentDirectoryPath)) {
                currentDirectoryPath = path.dirname(currentDirectoryPath);
                continue;
            }

            const entries = fs.readdirSync(currentDirectoryPath);
            if (entries.length > 0) {
                break;
            }

            fs.rmdirSync(currentDirectoryPath);
            currentDirectoryPath = path.dirname(currentDirectoryPath);
        }
    }

    _chunk(arr, n) {
        return Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    }
}
