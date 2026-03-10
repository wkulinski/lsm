import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import SkillDiscovery from "./SkillDiscovery.mjs";

export default class Publisher {
    constructor({ backend, manifestStore }) {
        this.backend = backend;
        this.manifestStore = manifestStore;
    }

    publish({
        manifest,
        lock,
        source,
        newSkills = [],
        removeSkills = [],
        dryRun = false,
        confirmDeletes = false,
        message = null,
        branch = null,
        createPr = null,
        title = null,
        body = null,
    }) {
        const resolved = this._resolvePublishParameters({
            manifest,
            source,
            newSkills,
            removeSkills,
            createPr,
        });
        if (!resolved.ok) {
            return resolved;
        }

        const prepared = this._preparePublishContext({
            manifest,
            lock,
            targetSource: resolved.targetSource,
            selectedNewSkills: resolved.selectedNewSkills,
            selectedRemoveSkills: resolved.selectedRemoveSkills,
            effectiveCreatePr: resolved.effectiveCreatePr,
            dryRun,
            confirmDeletes,
        });
        if (!prepared.ok || prepared.result) {
            return prepared.result ?? prepared;
        }

        return this._executePublish({
            ...prepared.context,
            branch,
            dryRun,
            message,
            title,
            body,
            selectedNewSkills: resolved.selectedNewSkills,
            selectedRemoveSkills: resolved.selectedRemoveSkills,
            effectiveCreatePr: resolved.effectiveCreatePr,
            publishConfig: resolved.publishConfig,
        });
    }

    _resolvePublishParameters({ manifest, source, newSkills, removeSkills, createPr }) {
        const targetSource = this._resolveTargetSource(manifest, source);
        if (!targetSource.ok) {
            return targetSource;
        }

        const publishConfig = targetSource.sourceEntry.publish ?? {};
        const selectedNewSkills = this._normalizeNewSkills(newSkills);
        const selectedRemoveSkills = this._normalizeRemoveSkills(removeSkills);
        const conflictingSkills = selectedNewSkills.filter((skillName) => (
            selectedRemoveSkills.some((removeName) => removeName.toLowerCase() === skillName.toLowerCase())
        ));
        if (conflictingSkills.length > 0) {
            return {
                ok: false,
                error: "Conflicting publish selection.",
                details: `A skill cannot be both new and removed: ${conflictingSkills.join(", ")}`,
            };
        }
        const effectiveCreatePr = typeof createPr === "boolean"
            ? createPr
            : (typeof publishConfig.createPr === "boolean" ? publishConfig.createPr : true);

        return {
            ok: true,
            targetSource,
            publishConfig,
            selectedNewSkills,
            selectedRemoveSkills,
            effectiveCreatePr,
        };
    }

    _preparePublishContext({
        manifest,
        lock,
        targetSource,
        selectedNewSkills,
        selectedRemoveSkills,
        effectiveCreatePr,
        dryRun,
        confirmDeletes,
    }) {
        const lockSourceResult = this._readLockSource(lock, targetSource.source);
        if (!lockSourceResult.ok) {
            return lockSourceResult;
        }

        const localSkillDirResult = this._resolvePrimaryLocalSkillDir(manifest);
        if (!localSkillDirResult.ok) {
            return localSkillDirResult;
        }

        const localSkills = this._discoverLocalSkills(localSkillDirResult.skillDir);
        const plan = this._buildPublishPlan({
            localSkills,
            lock,
            lockSource: lockSourceResult.lockSource,
            targetSource: targetSource.source,
            newSkills: selectedNewSkills,
            removeSkills: selectedRemoveSkills,
        });
        if (plan.errors.length > 0) {
            return {
                ok: false,
                error: "Invalid publish selection.",
                details: plan.errors.join("\n"),
            };
        }
        if (plan.deleteItems.length > 0 && !dryRun && !confirmDeletes) {
            return {
                ok: false,
                error: "Delete operations were planned but --confirm-deletes was not provided.",
                details: this._formatDeleteItems(plan.deleteItems),
            };
        }
        if (plan.items.length === 0) {
            return {
                ok: true,
                result: this._buildBasePublishResult({
                    source: targetSource.source,
                    dryRun,
                    changedFiles: [],
                    warnings: plan.warnings,
                    newSkills: selectedNewSkills,
                    removeSkills: selectedRemoveSkills,
                    createPr: effectiveCreatePr,
                    message: "No publishable changes found.",
                }),
            };
        }

        const sourceInfo = this.backend.resolveSource(targetSource.source);
        if (!sourceInfo.ok) {
            return {
                ok: false,
                error: sourceInfo.error,
            };
        }

        return {
            ok: true,
            context: {
                targetSource: targetSource.source,
                lockSource: lockSourceResult.lockSource,
                resolvedCommit: lockSourceResult.resolvedCommit,
                plan,
                sourceInfo,
            },
        };
    }

    _readLockSource(lock, sourceName) {
        const lockSource = lock.sources?.[sourceName];
        if (!lockSource) {
            return {
                ok: false,
                error: `Source "${sourceName}" is missing in skills.lock.json. Run sync first.`,
            };
        }

        const resolvedCommit = lockSource.resolved?.resolvedCommit;
        if (!resolvedCommit) {
            return {
                ok: false,
                error: `Missing resolved commit for "${sourceName}" in lock. Run sync first.`,
            };
        }

        return { ok: true, lockSource, resolvedCommit };
    }

    _executePublish({
        targetSource,
        lockSource,
        resolvedCommit,
        plan,
        sourceInfo,
        publishConfig,
        selectedNewSkills,
        selectedRemoveSkills,
        effectiveCreatePr,
        dryRun,
        message,
        branch,
        title,
        body,
    }) {
        let cloneDir = null;
        try {
            const workspace = this._preparePublishWorkspace({
                sourceInfo,
                resolvedCommit,
                branch,
                publishConfig,
            });
            if (!workspace.ok) {
                return workspace;
            }

            cloneDir = workspace.cloneDir;
            const staged = this._stagePublishPlan({ cloneDir, planItems: plan.items });
            if (!staged.ok) {
                return staged;
            }
            if (staged.result) {
                return this._buildBasePublishResult({
                    source: targetSource,
                    branch: workspace.branchName,
                    dryRun,
                    changedFiles: [],
                    warnings: plan.warnings,
                    newSkills: selectedNewSkills,
                    removeSkills: selectedRemoveSkills,
                    createPr: effectiveCreatePr,
                    message: staged.result.message,
                });
            }

            if (dryRun) {
                return this._buildBasePublishResult({
                    source: targetSource,
                    branch: workspace.branchName,
                    dryRun: true,
                    changedFiles: staged.changedFiles,
                    warnings: plan.warnings,
                    newSkills: selectedNewSkills,
                    removeSkills: selectedRemoveSkills,
                    createPr: effectiveCreatePr,
                    message: "Dry-run completed.",
                });
            }

            const commitAndPush = this._commitAndPushPublishChanges({
                cloneDir,
                branchName: workspace.branchName,
                message,
            });
            if (!commitAndPush.ok) {
                return commitAndPush;
            }

            const metadata = this._resolvePublishMetadata({
                cloneDir,
                lockSource,
                sourceInfo,
                branchName: workspace.branchName,
                resolvedCommit,
                selectedNewSkills,
                selectedRemoveSkills,
                effectiveCreatePr,
                title,
                body,
                warnings: plan.warnings,
            });

            return {
                ok: true,
                source: targetSource,
                branch: workspace.branchName,
                baseBranch: metadata.baseBranch,
                dryRun: false,
                changedFiles: staged.changedFiles,
                commitSha: commitAndPush.commitSha,
                compareUrl: metadata.compareUrl,
                pr: metadata.pr,
                warnings: metadata.warnings,
                newSkills: selectedNewSkills,
                removeSkills: selectedRemoveSkills,
                createPr: effectiveCreatePr,
                message: "Publish completed.",
            };
        } finally {
            if (cloneDir) {
                this._cleanupTempDir(cloneDir);
            }
        }
    }

    _preparePublishWorkspace({ sourceInfo, resolvedCommit, branch, publishConfig }) {
        const cloned = this._cloneRepository(sourceInfo.url);
        if (!cloned.ok) {
            return cloned;
        }

        const cloneDir = cloned.dir;
        const hasCommit = this._git(cloneDir, ["cat-file", "-e", `${resolvedCommit}^{commit}`]).ok;
        if (!hasCommit) {
            this._cleanupTempDir(cloneDir);
            return {
                ok: false,
                error: `Commit ${resolvedCommit} not found in source history.`,
            };
        }

        const branchName = branch || this._defaultBranchName(resolvedCommit, publishConfig.branchPrefix);
        const checkout = this._git(cloneDir, ["checkout", "-b", branchName, resolvedCommit]);
        if (!checkout.ok) {
            this._cleanupTempDir(cloneDir);
            return {
                ok: false,
                error: `Failed to create publish branch "${branchName}" from ${resolvedCommit}.`,
            };
        }

        return { ok: true, cloneDir, branchName };
    }

    _stagePublishPlan({ cloneDir, planItems }) {
        const stagedPaths = this._applyPlan(planItems, cloneDir);
        if (stagedPaths.length === 0) {
            return {
                ok: true,
                result: { message: "No file changes detected after applying publish plan." },
            };
        }

        const addResult = this._git(cloneDir, ["add", "--", ...stagedPaths]);
        if (!addResult.ok) {
            return {
                ok: false,
                error: "Failed to stage publish changes.",
                details: addResult.stderr || addResult.stdout,
            };
        }

        const changedFiles = this._readChangedFiles(cloneDir);
        if (changedFiles.length === 0) {
            return {
                ok: true,
                result: { message: "No git changes detected after staging publish plan." },
            };
        }

        return { ok: true, changedFiles };
    }

    _commitAndPushPublishChanges({ cloneDir, branchName, message }) {
        const commitMessage = message || "chore(skills): publish managed skills";
        const commitResult = this._git(cloneDir, ["commit", "-m", commitMessage]);
        if (!commitResult.ok) {
            return {
                ok: false,
                error: "Failed to create publish commit.",
                details: commitResult.stderr || commitResult.stdout,
            };
        }

        const commitShaResult = this._git(cloneDir, ["rev-parse", "HEAD"]);
        const commitSha = commitShaResult.ok ? commitShaResult.stdout.trim() : null;

        const pushResult = this._git(cloneDir, ["push", "-u", "origin", branchName]);
        if (!pushResult.ok) {
            return {
                ok: false,
                error: "Failed to push publish branch.",
                details: pushResult.stderr || pushResult.stdout,
            };
        }

        return { ok: true, commitSha };
    }

    _resolvePublishMetadata({
        cloneDir,
        lockSource,
        sourceInfo,
        branchName,
        resolvedCommit,
        selectedNewSkills,
        selectedRemoveSkills,
        effectiveCreatePr,
        title,
        body,
        warnings,
    }) {
        const baseBranch = lockSource.resolved?.defaultBranch
            || this._detectOriginHeadBranch(cloneDir)
            || "master";
        const compareUrl = this._buildCompareUrl(sourceInfo.webUrl, baseBranch, branchName);
        const pr = this._createPublishPr({
            cloneDir,
            sourceInfo,
            baseBranch,
            branchName,
            resolvedCommit,
            selectedNewSkills,
            selectedRemoveSkills,
            effectiveCreatePr,
            title,
            body,
        });

        return {
            baseBranch,
            compareUrl,
            pr: pr.pr,
            warnings: [...warnings, ...pr.warnings],
        };
    }

    _createPublishPr({
        cloneDir,
        sourceInfo,
        baseBranch,
        branchName,
        resolvedCommit,
        selectedNewSkills,
        selectedRemoveSkills,
        effectiveCreatePr,
        title,
        body,
    }) {
        if (!effectiveCreatePr) {
            return { pr: null, warnings: [] };
        }

        const prResult = this._createPullRequest({
            cwd: cloneDir,
            sourceInfo,
            baseBranch,
            branchName,
            title: title || "chore(skills): publish managed skills",
            body: body || this._defaultPrBody({
                resolvedCommit,
                newSkills: selectedNewSkills,
                removeSkills: selectedRemoveSkills,
            }),
        });
        if (prResult.ok) {
            return { pr: prResult, warnings: [] };
        }

        return { pr: null, warnings: [prResult.error] };
    }

    _buildBasePublishResult({
        source,
        branch = null,
        dryRun,
        changedFiles,
        warnings,
        newSkills,
        removeSkills,
        createPr,
        message,
    }) {
        return {
            ok: true,
            source,
            branch,
            dryRun,
            changedFiles,
            warnings,
            newSkills,
            removeSkills,
            createPr,
            message,
        };
    }

    _resolveTargetSource(manifest, source) {
        if (source) {
            const selected = manifest.sources.find((entry) => entry.source === source);
            if (!selected) {
                return {
                    ok: false,
                    error: `Source "${source}" not found in manifest.`,
                };
            }
            return { ok: true, source: selected.source, sourceEntry: selected };
        }

        if (manifest.sources.length === 1) {
            const selected = manifest.sources[0];
            return { ok: true, source: selected.source, sourceEntry: selected };
        }

        return {
            ok: false,
            error: "Multiple sources configured. Use --source <source>.",
        };
    }

    _resolvePrimaryLocalSkillDir(manifest) {
        const resolvedDirs = this.backend.resolveAgentProjectSkillDirs(manifest.agents);
        if (!resolvedDirs.ok) {
            return { ok: false, error: resolvedDirs.error };
        }

        if (!resolvedDirs.dirs.length) {
            return {
                ok: false,
                error: "Could not resolve local skill directory for configured agents.",
            };
        }

        return { ok: true, skillDir: resolvedDirs.dirs[0] };
    }

    _discoverLocalSkills(localSkillDir) {
        const discovery = new SkillDiscovery({ includeInternal: true, fullDepth: true });
        const localSkillDirRelative = this._normalizePosix(path.relative(this.backend.root, localSkillDir));
        const discovered = discovery.discover(this.backend.root, localSkillDirRelative);
        const byAlias = new Map();

        discovered.skills.forEach((skill) => {
            const skillName = skill.name.toLowerCase();
            if (byAlias.has(skillName)) {
                return;
            }
            const localSkill = {
                name: skill.name,
                path: skill.path,
                dirName: path.basename(skill.path),
                sourcePath: this._normalizePosix(path.relative(this.backend.root, skill.path)),
                sharedFiles: Array.isArray(skill.sharedFiles) ? skill.sharedFiles : [],
            };
            byAlias.set(skillName, localSkill);

            const dirNameAlias = localSkill.dirName.toLowerCase();
            if (!byAlias.has(dirNameAlias)) {
                byAlias.set(dirNameAlias, localSkill);
            }
        });

        return byAlias;
    }

    _buildPublishPlan({ localSkills, lock, lockSource, targetSource, newSkills, removeSkills }) {
        const items = [];
        const warnings = [];
        const errors = [];
        const managedEntries = this._resolveManagedEntries(lockSource);
        const managedByName = new Map(managedEntries.map((entry) => [entry.name.toLowerCase(), entry]));
        const removeRequestedSet = new Set(removeSkills.map((name) => name.toLowerCase()));
        const managedSourcePaths = new Set();
        const selectedSkills = new Map();
        const skippedMissingManagedEntries = [];

        const targetSourceSkillsRoot = this._resolveSourceSkillsRootPrefix(managedEntries);
        if (!targetSourceSkillsRoot.ok) {
            return {
                items: [],
                deleteItems: [],
                warnings,
                errors: [`Cannot resolve target skills root for source "${targetSource}": ${targetSourceSkillsRoot.error}`],
            };
        }

        const localSourceSkillsRoot = this._resolveSourceSkillsRootPrefix(
            [...new Map(
                [...localSkills.values()].map((skill) => [skill.sourcePath, { sourcePath: skill.sourcePath }])
            ).values()]
        );
        if (!localSourceSkillsRoot.ok) {
            return {
                items: [],
                deleteItems: [],
                warnings,
                errors: [`Cannot resolve local skills root: ${localSourceSkillsRoot.error}`],
            };
        }

        removeSkills.forEach((requestedSkill) => {
            if (!managedByName.has(requestedSkill.toLowerCase())) {
                errors.push(`Skill "${requestedSkill}" was requested via --remove-skill but is not managed by source "${targetSource}".`);
            }
        });

        managedEntries.forEach((entry) => {
            managedSourcePaths.add(entry.sourcePath);
            const localSkill = localSkills.get(entry.name.toLowerCase());
            const shouldRemove = removeRequestedSet.has(entry.name.toLowerCase());
            if (shouldRemove) {
                if (localSkill) {
                    errors.push(`Skill "${entry.name}" is still present locally; remove it before using --remove-skill.`);
                    return;
                }

                items.push({
                    type: "delete",
                    deleteKind: "directory",
                    targetPath: entry.sourcePath,
                    skillName: entry.name,
                });
                return;
            }

            if (!localSkill) {
                warnings.push(
                    `Skill "${entry.name}" is managed but missing locally; skipping upstream deletion. `
                    + `Use --remove-skill "${entry.name}" and --confirm-deletes to remove it upstream.`
                );
                skippedMissingManagedEntries.push(entry);
                return;
            }

            selectedSkills.set(localSkill.name.toLowerCase(), localSkill);
            items.push({
                type: "directory",
                localPath: localSkill.path,
                targetPath: entry.sourcePath,
            });
        });

        if (newSkills.length > 0) {
            const globallyManaged = new Set(
                this.manifestStore.lockManagedSkills(lock.sources).map((name) => name.toLowerCase())
            );
            const managedOwners = this._resolveManagedSkillOwners(lock.sources);
            const selected = new Set();

            newSkills.forEach((requestedSkill) => {
                const localSkill = localSkills.get(requestedSkill.toLowerCase());
                if (!localSkill) {
                    errors.push(`Skill "${requestedSkill}" was requested via --new-skill but not found locally.`);
                    return;
                }

                const localSkillKey = localSkill.name.toLowerCase();
                if (selected.has(localSkillKey)) {
                    return;
                }
                if (globallyManaged.has(localSkillKey)) {
                    const owner = managedOwners.get(localSkillKey);
                    const ownerMsg = owner ? ` (already managed by source: ${owner})` : "";
                    errors.push(`Skill "${localSkill.name}" is not new${ownerMsg}.`);
                    return;
                }

                const relativeSkillPath = this._relativeToSkillsRoot(localSkill.sourcePath, localSourceSkillsRoot.prefix);
                if (!relativeSkillPath) {
                    errors.push(`Cannot map local skill "${localSkill.name}" under local skills root "${localSourceSkillsRoot.prefix}".`);
                    return;
                }

                const targetPath = this._normalizePosix(path.posix.join(targetSourceSkillsRoot.prefix, relativeSkillPath));
                if (managedSourcePaths.has(targetPath)) {
                    errors.push(`Skill "${localSkill.name}" conflicts with existing target path "${targetPath}".`);
                    return;
                }

                selected.add(localSkillKey);
                managedSourcePaths.add(targetPath);
                selectedSkills.set(localSkillKey, localSkill);
                items.push({
                    type: "directory",
                    localPath: localSkill.path,
                    targetPath,
                    isNewSkill: true,
                });
            });
        }

        const selectedSharedFiles = new Set();
        selectedSkills.forEach((localSkill) => {
            (localSkill.sharedFiles ?? []).forEach((sharedFilePath) => selectedSharedFiles.add(sharedFilePath));
        });

        const sharedFileOwners = this._resolveSharedFileOwners(lock.sources, localSourceSkillsRoot.prefix);
        const selectedSharedTargetPaths = new Set();
        [...selectedSharedFiles].sort((a, b) => a.localeCompare(b)).forEach((localSharedFilePath) => {
            const relativeSharedPath = this._relativeToSkillsRoot(localSharedFilePath, localSourceSkillsRoot.prefix);
            if (!relativeSharedPath) {
                errors.push(`Cannot map shared file "${localSharedFilePath}" under local skills root "${localSourceSkillsRoot.prefix}".`);
                return;
            }

            const targetSharedPath = this._normalizePosix(path.posix.join(targetSourceSkillsRoot.prefix, relativeSharedPath));
            const owner = sharedFileOwners.get(localSharedFilePath);
            if (owner && owner !== targetSource) {
                errors.push(`Shared file "${localSharedFilePath}" is already owned by source "${owner}".`);
                return;
            }

            const localPath = path.resolve(this.backend.root, localSharedFilePath);
            if (!this._isPathInside(localPath, this.backend.root)) {
                errors.push(`Shared file path escapes project root: ${localSharedFilePath}`);
                return;
            }
            if (!fs.existsSync(localPath)) {
                errors.push(`Shared file "${localSharedFilePath}" does not exist locally.`);
                return;
            }
            if (!fs.statSync(localPath).isFile()) {
                errors.push(`Shared file "${localSharedFilePath}" is not a regular file.`);
                return;
            }

            selectedSharedTargetPaths.add(targetSharedPath);
            items.push({
                type: "file",
                localPath,
                targetPath: targetSharedPath,
                isSharedFile: true,
            });
        });

        const protectedSharedPaths = new Set(
            skippedMissingManagedEntries.flatMap((entry) => entry.sharedFiles ?? [])
        );
        const warnedProtectedSharedPaths = new Set();
        const previouslyManagedSharedFiles = this._collectSharedFilesFromSkillEntries(lockSource.skillEntries);
        previouslyManagedSharedFiles.forEach((targetSharedPath) => {
            if (selectedSharedTargetPaths.has(targetSharedPath)) {
                return;
            }
            if (protectedSharedPaths.has(targetSharedPath)) {
                if (!warnedProtectedSharedPaths.has(targetSharedPath)) {
                    warnings.push(
                        `Shared file "${targetSharedPath}" remains unmanaged for now because at least one missing managed skill `
                        + "was not explicitly removed."
                    );
                    warnedProtectedSharedPaths.add(targetSharedPath);
                }
                return;
            }

            items.push({
                type: "delete",
                deleteKind: "file",
                targetPath: targetSharedPath,
                isSharedFile: true,
            });
        });

        const deleteItems = items.filter((item) => item.type === "delete");
        return { items, deleteItems, warnings, errors };
    }

    _resolveManagedEntries(lockSource) {
        if (!Array.isArray(lockSource.skillEntries)) {
            return [];
        }

        return lockSource.skillEntries.map((entry) => ({
            name: entry.name,
            sourcePath: this._normalizePosix(entry.sourcePath),
            sharedFiles: this._normalizeSharedFiles(entry.sharedFiles),
        }));
    }

    _resolveManagedSkillOwners(lockSources) {
        const owners = new Map();
        Object.entries(lockSources ?? {}).forEach(([source, sourceMeta]) => {
            const entries = this._resolveManagedEntries(sourceMeta);
            entries.forEach((entry) => {
                const key = String(entry.name ?? "").trim().toLowerCase();
                if (!key || owners.has(key)) {
                    return;
                }
                owners.set(key, source);
            });
        });
        return owners;
    }

    _resolveSharedFileOwners(lockSources, localSkillsRootPrefix) {
        const owners = new Map();

        Object.entries(lockSources ?? {}).forEach(([source, sourceMeta]) => {
            const sourceEntries = this._resolveManagedEntries(sourceMeta);
            const sourceRoot = this._resolveSourceSkillsRootPrefix(sourceEntries);
            if (!sourceRoot.ok) {
                return;
            }

            (Array.isArray(sourceMeta?.skillEntries) ? sourceMeta.skillEntries : []).forEach((entry) => {
                const sharedFiles = Array.isArray(entry?.sharedFiles) ? entry.sharedFiles : [];
                sharedFiles.forEach((sourceSharedFilePath) => {
                    const relativePath = this._relativeToSkillsRoot(sourceSharedFilePath, sourceRoot.prefix);
                    if (!relativePath) {
                        return;
                    }

                    const localPath = this._normalizePosix(path.posix.join(localSkillsRootPrefix, relativePath));
                    if (!owners.has(localPath)) {
                        owners.set(localPath, source);
                    }
                });
            });
        });

        return owners;
    }

    _resolveSourceSkillsRootPrefix(entries) {
        const roots = [...new Set(
            (Array.isArray(entries) ? entries : [])
                .map((entry) => this._extractSkillsRootPrefix(entry?.sourcePath))
                .filter(Boolean)
        )].sort((a, b) => a.localeCompare(b));

        if (roots.length === 0) {
            return { ok: false, error: "No skills root could be inferred." };
        }
        if (roots.length > 1) {
            return { ok: false, error: `Multiple skills roots detected: ${roots.join(", ")}` };
        }

        return { ok: true, prefix: roots[0] };
    }

    _extractSkillsRootPrefix(sourcePath) {
        const normalized = this._normalizePosix(String(sourcePath ?? "").trim());
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
        const normalizedPath = this._normalizePosix(String(sourcePath ?? "").trim());
        const normalizedRoot = this._normalizePosix(String(skillsRootPrefix ?? "").trim());
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

    _normalizeNewSkills(newSkills) {
        return this._normalizeSkillNameList(newSkills);
    }

    _normalizeRemoveSkills(removeSkills) {
        return this._normalizeSkillNameList(removeSkills);
    }

    _normalizeSkillNameList(values) {
        if (!Array.isArray(values)) {
            return [];
        }

        const unique = new Map();
        values.forEach((value) => {
            const normalized = String(value ?? "").trim();
            if (!normalized) {
                return;
            }
            const key = normalized.toLowerCase();
            if (!unique.has(key)) {
                unique.set(key, normalized);
            }
        });

        return [...unique.values()];
    }

    _normalizeSharedFiles(values) {
        return [...new Set(
            (Array.isArray(values) ? values : [])
                .map((entry) => this._normalizePosix(String(entry ?? "").trim()))
                .filter(Boolean)
        )].sort((a, b) => a.localeCompare(b));
    }

    _collectSharedFilesFromSkillEntries(skillEntries) {
        return [...new Set(
            (Array.isArray(skillEntries) ? skillEntries : [])
                .flatMap((entry) => (Array.isArray(entry?.sharedFiles) ? entry.sharedFiles : []))
                .map((entry) => this._normalizePosix(String(entry ?? "").trim()))
                .filter(Boolean)
        )].sort((a, b) => a.localeCompare(b));
    }

    _cloneRepository(url) {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-publish-"));
        const res = spawnSync("git", ["clone", url, tempDir], { encoding: "utf8" });
        if (res.error?.code === "ENOENT") {
            this._cleanupTempDir(tempDir);
            return { ok: false, error: "git not found in PATH" };
        }

        if (res.status !== 0) {
            this._cleanupTempDir(tempDir);
            return {
                ok: false,
                error: `Git clone failed (exit=${res.status})`,
                details: res.stderr || res.stdout,
            };
        }

        return { ok: true, dir: tempDir };
    }

    _applyPlan(items, cloneDir) {
        const stagedPaths = new Set();
        items.forEach((item) => {
            if (item.type === "directory") {
                const copiedFiles = this._copyDirectory({
                    sourceDir: item.localPath,
                    cloneDir,
                    targetBasePath: item.targetPath,
                });
                copiedFiles.forEach((relativeFilePath) => stagedPaths.add(relativeFilePath));
                return;
            }

            if (item.type === "delete") {
                const targetPath = this._normalizePosix(item.targetPath);
                const destination = path.resolve(cloneDir, targetPath);
                if (!this._isPathInside(destination, cloneDir)) {
                    return;
                }
                if (!fs.existsSync(destination)) {
                    return;
                }
                const destinationStat = fs.lstatSync(destination);
                const deleteKind = item.deleteKind === "directory" ? "directory" : "file";
                if (deleteKind === "directory" && !destinationStat.isDirectory()) {
                    return;
                }
                if (deleteKind === "file" && !destinationStat.isFile()) {
                    return;
                }
                fs.rmSync(destination, {
                    recursive: deleteKind === "directory",
                    force: true,
                });
                this._cleanupEmptyParents(path.dirname(destination), cloneDir);
                stagedPaths.add(targetPath);
                return;
            }

            const targetPath = this._normalizePosix(item.targetPath);
            const destination = path.resolve(cloneDir, targetPath);
            if (!this._isPathInside(destination, cloneDir)) {
                return;
            }
            this._ensureParentDirectory(destination);
            fs.copyFileSync(item.localPath, destination);
            stagedPaths.add(targetPath);
        });

        return [...stagedPaths].sort((a, b) => a.localeCompare(b));
    }

    _copyDirectory({ sourceDir, cloneDir, targetBasePath }) {
        const copied = [];
        const files = this._collectFilesRecursively(sourceDir);
        files.forEach((fileEntry) => {
            const relativeTargetPath = this._normalizePosix(path.posix.join(targetBasePath, fileEntry.relativePath));
            const destinationPath = path.resolve(cloneDir, relativeTargetPath);
            if (!this._isPathInside(destinationPath, cloneDir)) {
                return;
            }
            this._ensureParentDirectory(destinationPath);
            fs.copyFileSync(fileEntry.absolutePath, destinationPath);
            copied.push(relativeTargetPath);
        });

        return copied;
    }

    _collectFilesRecursively(basePath, currentRelativePath = "") {
        const currentPath = currentRelativePath ? path.join(basePath, currentRelativePath) : basePath;
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        const files = [];

        entries.forEach((entry) => {
            const nestedRelativePath = currentRelativePath
                ? path.join(currentRelativePath, entry.name)
                : entry.name;

            if (entry.isSymbolicLink()) {
                return;
            }

            if (entry.isDirectory()) {
                const nestedFiles = this._collectFilesRecursively(basePath, nestedRelativePath);
                nestedFiles.forEach((nestedFile) => files.push(nestedFile));
                return;
            }

            if (!entry.isFile()) {
                return;
            }

            files.push({
                absolutePath: path.join(basePath, nestedRelativePath),
                relativePath: this._normalizePosix(nestedRelativePath),
            });
        });

        return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }

    _readChangedFiles(cwd) {
        const result = this._git(cwd, ["diff", "--cached", "--name-status"]);
        if (!result.ok) {
            return [];
        }

        return result.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const [status, ...rest] = line.split(/\s+/);
                return {
                    status,
                    path: rest.join(" "),
                };
            });
    }

    _detectOriginHeadBranch(cwd) {
        const result = this._git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
        if (!result.ok) {
            return null;
        }

        const value = result.stdout.trim();
        if (!value) {
            return null;
        }

        return value.replace(/^origin\//, "");
    }

    _createPullRequest({ cwd, sourceInfo, baseBranch, branchName, title, body }) {
        if (!this._isGhAvailable()) {
            return {
                ok: false,
                error: "gh CLI is not available or not authenticated; PR was not created automatically.",
                compareUrl: this._buildCompareUrl(sourceInfo.webUrl, baseBranch, branchName),
            };
        }

        const result = spawnSync("gh", [
            "pr",
            "create",
            "--base",
            baseBranch,
            "--head",
            branchName,
            "--title",
            title,
            "--body",
            body,
        ], {
            encoding: "utf8",
            cwd,
        });

        if (result.status !== 0) {
            return {
                ok: false,
                error: `Failed to create PR automatically: ${(result.stderr || result.stdout || "").trim()}`,
                compareUrl: this._buildCompareUrl(sourceInfo.webUrl, baseBranch, branchName),
            };
        }

        const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
        const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
        return {
            ok: true,
            url: urlMatch ? urlMatch[0] : null,
            output,
        };
    }

    _isGhAvailable() {
        const result = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
        return result.status === 0;
    }

    _buildCompareUrl(webUrl, baseBranch, branchName) {
        if (!webUrl) {
            return null;
        }

        return `${webUrl}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branchName)}?expand=1`;
    }

    _defaultPrBody({ resolvedCommit, newSkills, removeSkills }) {
        return [
            "Published automatically using Llm Skills Manager (wkulinski/lsm).",
            "",
            `Base commit from lock: ${resolvedCommit}`,
            `Selected new skills: ${newSkills.length ? newSkills.join(", ") : "none"}`,
            `Selected removed skills: ${removeSkills.length ? removeSkills.join(", ") : "none"}`,
        ].join("\n");
    }

    _formatDeleteItems(deleteItems) {
        const normalized = (Array.isArray(deleteItems) ? deleteItems : [])
            .map((item) => {
                const kind = item?.deleteKind === "directory" ? "directory" : "file";
                const targetPath = this._normalizePosix(String(item?.targetPath ?? "").trim());
                if (!targetPath) {
                    return null;
                }

                return `  - [${kind}] ${targetPath}`;
            })
            .filter(Boolean);

        if (normalized.length === 0) {
            return "No delete paths resolved.";
        }

        return [
            "Planned delete paths:",
            ...normalized,
            "",
            "Re-run with --confirm-deletes to allow these deletions.",
        ].join("\n");
    }

    _defaultBranchName(resolvedCommit, prefix = null) {
        const branchPrefix = (typeof prefix === "string" && prefix.trim())
            ? prefix.trim().replace(/\/+$/, "")
            : "skills-sync/publish";
        const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
        return `${branchPrefix}-${timestamp}-${resolvedCommit.slice(0, 8)}`;
    }

    _git(cwd, args) {
        const result = spawnSync("git", args, { encoding: "utf8", cwd });
        return {
            ok: result.status === 0,
            status: result.status ?? 1,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
        };
    }

    _normalizePosix(value) {
        return String(value).replace(/\\/g, "/");
    }

    _isPathInside(candidatePath, rootPath) {
        const relative = path.relative(rootPath, candidatePath);
        return !(relative.startsWith("..") || path.isAbsolute(relative));
    }

    _ensureParentDirectory(filePath) {
        const parent = path.dirname(filePath);
        if (!fs.existsSync(parent)) {
            fs.mkdirSync(parent, { recursive: true });
        }
    }

    _cleanupEmptyParents(startDirectoryPath, rootPath) {
        let currentDirectoryPath = path.resolve(startDirectoryPath);
        const normalizedRootPath = path.resolve(rootPath);

        while (currentDirectoryPath.startsWith(normalizedRootPath) && currentDirectoryPath !== normalizedRootPath) {
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

    _cleanupTempDir(dir) {
        if (!dir) {
            return;
        }
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (e) {
            // best-effort cleanup
        }
    }
}
