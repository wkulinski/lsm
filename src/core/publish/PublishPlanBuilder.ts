import fs from 'node:fs';
import path from 'node:path';

import { isPathInside } from '../filesystem/PathUtils';
import type {
    LocalSkill,
    LockData,
    LockSourceMeta,
    SkillEntry,
} from '../types';
import PublishPathMapper from './PublishPathMapper';

export interface PublishPlanBuilderManifestStore {
    lockManagedSkills(lockSources: { [key: string]: LockSourceMeta } | undefined): string[];
}

export interface DirectoryPublishItem {
    type: 'directory';
    localPath: string;
    targetPath: string;
    isNewSkill?: boolean;
}

export interface FilePublishItem {
    type: 'file';
    localPath: string;
    targetPath: string;
    isSharedFile?: boolean;
}

export interface DeletePublishItem {
    type: 'delete';
    deleteKind: 'directory' | 'file';
    targetPath: string;
    skillName?: string;
    isSharedFile?: boolean;
}

export type PublishPlanItem = DirectoryPublishItem | FilePublishItem | DeletePublishItem;

export interface PublishPlan {
    items: PublishPlanItem[];
    deleteItems: DeletePublishItem[];
    warnings: string[];
    errors: string[];
}

export default class PublishPlanBuilder {
    private readonly projectRoot: string;
    private readonly manifestStore: PublishPlanBuilderManifestStore;
    private readonly pathMapper: PublishPathMapper;

    public constructor({
        projectRoot,
        manifestStore,
        pathMapper = new PublishPathMapper(),
    }: {
        projectRoot: string;
        manifestStore: PublishPlanBuilderManifestStore;
        pathMapper?: PublishPathMapper;
    }) {
        this.projectRoot = projectRoot;
        this.manifestStore = manifestStore;
        this.pathMapper = pathMapper;
    }

    public build({
        localSkills, lock, lockSource, targetSource, newSkills, removeSkills,
    }: {
        localSkills: Map<string, LocalSkill>;
        lock: LockData;
        lockSource: LockSourceMeta;
        targetSource: string;
        newSkills: string[];
        removeSkills: string[];
    }): PublishPlan {
        const items: PublishPlanItem[] = [];
        const warnings: string[] = [];
        const errors: string[] = [];
        const managedEntries = this.pathMapper.resolveManagedEntries(lockSource);
        const managedByName = new Map(managedEntries.map(entry => [entry.name.toLowerCase(), entry]));
        const removeRequestedSet = new Set(removeSkills.map((name: string) => name.toLowerCase()));
        const managedSourcePaths = new Set<string>();
        const selectedSkills = new Map<string, LocalSkill>();
        const skippedMissingManagedEntries: SkillEntry[] = [];

        const targetSourceSkillsRoot = this.pathMapper.resolveSourceSkillsRootPrefix(managedEntries);
        if (!targetSourceSkillsRoot.ok) {
            return {
                items: [],
                deleteItems: [],
                warnings,
                errors: [`Cannot resolve target skills root for source "${targetSource}": ${targetSourceSkillsRoot.error}`],
            };
        }

        const localSourceSkillsRoot = this.pathMapper.resolveSourceSkillsRootPrefix(
            [...new Map(
                [...localSkills.values()].map(skill => [skill.sourcePath, { sourcePath: skill.sourcePath }]),
            ).values()],
        );
        if (!localSourceSkillsRoot.ok) {
            return {
                items: [],
                deleteItems: [],
                warnings,
                errors: [`Cannot resolve local skills root: ${localSourceSkillsRoot.error}`],
            };
        }

        removeSkills.forEach((requestedSkill: string) => {
            if (!managedByName.has(requestedSkill.toLowerCase())) {
                errors.push(`Skill "${requestedSkill}" was requested via --remove-skill but is not managed by source "${targetSource}".`);
            }
        });

        managedEntries.forEach((entry) => {
            if (!this.pathMapper.relativeToSkillsRoot(entry.sourcePath, targetSourceSkillsRoot.prefix)) {
                errors.push(`Managed skill "${entry.name}" resolves to the source skills root and cannot be published or removed.`);
                return;
            }
            managedSourcePaths.add(entry.sourcePath);
            const localSkill = localSkills.get(entry.name.toLowerCase());
            const shouldRemove = removeRequestedSet.has(entry.name.toLowerCase());
            if (shouldRemove) {
                if (localSkill) {
                    errors.push(`Skill "${entry.name}" is still present locally; remove it before using --remove-skill.`);
                    return;
                }

                items.push({
                    type: 'delete',
                    deleteKind: 'directory',
                    targetPath: entry.sourcePath,
                    skillName: entry.name,
                });
                return;
            }

            if (!localSkill) {
                warnings.push(
                    `Skill "${entry.name}" is managed but missing locally; skipping upstream deletion. `
                    + `Use --remove-skill "${entry.name}" and --confirm-deletes to remove it upstream.`,
                );
                skippedMissingManagedEntries.push(entry);
                return;
            }

            selectedSkills.set(localSkill.name.toLowerCase(), localSkill);
            items.push({
                type: 'directory',
                localPath: localSkill.path,
                targetPath: entry.sourcePath,
            });
        });

        if (newSkills.length > 0) {
            const globallyManaged = new Set(
                this.manifestStore.lockManagedSkills(lock.sources).map((name: string) => name.toLowerCase()),
            );
            const managedOwners = this.pathMapper.resolveManagedSkillOwners(lock.sources);
            const selected = new Set<string>();

            newSkills.forEach((requestedSkill: string) => {
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
                    const ownerMsg = owner ? ` (already managed by source: ${owner})` : '';
                    errors.push(`Skill "${localSkill.name}" is not new${ownerMsg}.`);
                    return;
                }

                const relativeSkillPath = this.pathMapper.relativeToSkillsRoot(localSkill.sourcePath, localSourceSkillsRoot.prefix);
                if (!relativeSkillPath) {
                    errors.push(`Cannot map local skill "${localSkill.name}" under local skills root "${localSourceSkillsRoot.prefix}".`);
                    return;
                }

                const targetPath = this.pathMapper.normalizePosix(path.posix.join(targetSourceSkillsRoot.prefix, relativeSkillPath));
                if (managedSourcePaths.has(targetPath)) {
                    errors.push(`Skill "${localSkill.name}" conflicts with existing target path "${targetPath}".`);
                    return;
                }

                selected.add(localSkillKey);
                managedSourcePaths.add(targetPath);
                selectedSkills.set(localSkillKey, localSkill);
                items.push({
                    type: 'directory',
                    localPath: localSkill.path,
                    targetPath,
                    isNewSkill: true,
                });
            });
        }

        const selectedSharedFiles = new Set<string>();
        selectedSkills.forEach((localSkill) => {
            localSkill.sharedFiles.forEach((sharedFilePath: string) => selectedSharedFiles.add(sharedFilePath));
        });

        const sharedFileOwners = this.pathMapper.resolveSharedFileOwners(lock.sources, localSourceSkillsRoot.prefix);
        const selectedSharedTargetPaths = new Set<string>();
        [...selectedSharedFiles].sort((a, b) => a.localeCompare(b)).forEach((localSharedFilePath) => {
            const relativeSharedPath = this.pathMapper.relativeToSkillsRoot(localSharedFilePath, localSourceSkillsRoot.prefix);
            if (!relativeSharedPath) {
                errors.push(`Cannot map shared file "${localSharedFilePath}" under local skills root "${localSourceSkillsRoot.prefix}".`);
                return;
            }

            const targetSharedPath = this.pathMapper.normalizePosix(path.posix.join(targetSourceSkillsRoot.prefix, relativeSharedPath));
            const owner = sharedFileOwners.get(localSharedFilePath);
            if (owner && owner !== targetSource) {
                errors.push(`Shared file "${localSharedFilePath}" is already owned by source "${owner}".`);
                return;
            }

            const localPath = path.resolve(this.projectRoot, localSharedFilePath);
            if (!isPathInside(localPath, this.projectRoot)) {
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
                type: 'file',
                localPath,
                targetPath: targetSharedPath,
                isSharedFile: true,
            });
        });

        const protectedSharedPaths = new Set<string>(
            skippedMissingManagedEntries.flatMap(entry => entry.sharedFiles),
        );
        const warnedProtectedSharedPaths = new Set<string>();
        const previouslyManagedSharedFiles = this.pathMapper.collectSharedFilesFromSkillEntries(lockSource.skillEntries);
        previouslyManagedSharedFiles.forEach((targetSharedPath) => {
            if (selectedSharedTargetPaths.has(targetSharedPath)) {
                return;
            }
            if (protectedSharedPaths.has(targetSharedPath)) {
                if (!warnedProtectedSharedPaths.has(targetSharedPath)) {
                    warnings.push(
                        `Shared file "${targetSharedPath}" remains unmanaged for now because at least one missing managed skill `
                        + 'was not explicitly removed.',
                    );
                    warnedProtectedSharedPaths.add(targetSharedPath);
                }
                return;
            }

            items.push({
                type: 'delete',
                deleteKind: 'file',
                targetPath: targetSharedPath,
                isSharedFile: true,
            });
        });

        const deleteItems = items.filter((item): item is DeletePublishItem => item.type === 'delete');
        return { items, deleteItems, warnings, errors };
    }

    public formatDeleteItems(deleteItems: DeletePublishItem[]): string {
        const normalized = (Array.isArray(deleteItems) ? deleteItems : [])
            .map((item: DeletePublishItem) => {
                const kind = item.deleteKind === 'directory' ? 'directory' : 'file';
                const targetPath = this.pathMapper.normalizePosix(item.targetPath.trim());
                if (!targetPath) {
                    return null;
                }

                return `  - [${kind}] ${targetPath}`;
            })
            .filter(Boolean);

        if (normalized.length === 0) {
            return 'No delete paths resolved.';
        }

        return [
            'Planned delete paths:',
            ...normalized,
            '',
            'Re-run with --confirm-deletes to allow these deletions.',
        ].join('\n');
    }
}
