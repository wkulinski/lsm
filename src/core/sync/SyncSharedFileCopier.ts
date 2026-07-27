import path from 'node:path';

import Hashing from '../shared/Hashing';
import { hasSymlinkInPath } from '../filesystem/PathUtils';
import { formatUnknown } from '../utils/formatUnknown';
import type { ManagedFileDeclaration } from './ManagedFileSynchronizer';
import SyncPathMapper from './SyncPathMapper';
import type {
    BackendLike,
    ManagedFileHashEntry,
    SharedSyncError,
    SharedSyncResult,
    SkillEntry,
} from '../types';

export interface SyncSharedFileCopyResult {
    managedLocalPaths: string[];
    fileHashes: SharedSyncResult['sharedFileHashesBySource'][string];
    managedFileHashes: ManagedFileHashEntry[];
    declarations: ManagedFileDeclaration[];
    stats: SharedSyncResult['sharedStats'][string];
    errors: SharedSyncError[];
}

export default class SyncSharedFileCopier {
    public backend: BackendLike;
    public pathMapper: SyncPathMapper;

    public constructor({ backend }: { backend: BackendLike }) {
        this.backend = backend;
        this.pathMapper = new SyncPathMapper({ backend });
    }

    public collectSourceSharedFiles(
        { source, skillEntries, agentSkillDirs, resolvedCommit = null }: { source: string; skillEntries: SkillEntry[]; agentSkillDirs: string[]; resolvedCommit?: string | null },
    ): SyncSharedFileCopyResult {
        const sourceSharedFiles = this.pathMapper.collectSharedFilesFromSkillEntries(skillEntries);
        let copiedFiles = 0;

        if (!sourceSharedFiles.length) {
            return {
                managedLocalPaths: [],
                fileHashes: [],
                managedFileHashes: [],
                declarations: [],
                stats: { declaredFiles: 0, copiedFiles: 0 },
                errors: [],
            };
        }

        const sourceSkillsRoot = this.pathMapper.resolveSourceSkillsRootPrefix(skillEntries);
        if (!sourceSkillsRoot.ok) {
            return {
                managedLocalPaths: [],
                fileHashes: [],
                managedFileHashes: [],
                declarations: [],
                stats: { declaredFiles: sourceSharedFiles.length, copiedFiles: 0 },
                errors: [{
                    source,
                    message: 'Error while resolving shared files root for source.',
                    details: sourceSkillsRoot.error,
                }],
            };
        }

        const collected = this.backend.collectSharedFiles(source, sourceSharedFiles, { resolvedCommit });
        if (!collected.ok) {
            return {
                managedLocalPaths: [],
                fileHashes: [],
                managedFileHashes: [],
                declarations: [],
                stats: { declaredFiles: sourceSharedFiles.length, copiedFiles: 0 },
                errors: [{
                    source,
                    message: 'Error while collecting shared files for source.',
                    details: collected.details ? formatUnknown(collected.details).slice(0, 2000) : collected.error,
                }],
            };
        }

        const fileHashes = collected.files
            .map(fileEntry => ({
                path: fileEntry.path.trim(),
                sha256: Hashing.sha256Buffer(fileEntry.content),
            }))
            .sort((a, b) => a.path.localeCompare(b.path));
        const managedFileHashes = collected.files
            .map(fileEntry => ({
                path: fileEntry.path.trim(),
                hash: {
                    sha256: Hashing.sha256Buffer(fileEntry.content),
                    executable: fileEntry.executable,
                },
            }))
            .sort((a, b) => a.path.localeCompare(b.path));
        const managedFiles = new Set<string>();
        const declarations: ManagedFileDeclaration[] = [];
        const errors: SharedSyncError[] = [];

        agentSkillDirs.forEach((agentSkillDir) => {
            collected.files.forEach((fileEntry) => {
                const relativeToSkillsRoot = this.pathMapper.relativeToSkillsRoot(fileEntry.path, sourceSkillsRoot.prefix);
                if (!relativeToSkillsRoot) {
                    errors.push({
                        source,
                        message: 'Shared file path does not match source skills root.',
                        details: `${sourceSkillsRoot.prefix ?? ''}: ${fileEntry.path}`,
                    });
                    return;
                }

                const destinationPath = path.resolve(agentSkillDir, relativeToSkillsRoot);
                if (!this.pathMapper.isPathInsideRoot(destinationPath)) {
                    errors.push({
                        source,
                        message: 'Shared file destination escapes project root.',
                        details: destinationPath,
                    });
                    return;
                }
                if (hasSymlinkInPath(destinationPath, this.backend.root)) {
                    errors.push({
                        source,
                        message: 'Shared file destination contains a symbolic link.',
                        details: destinationPath,
                    });
                    return;
                }

                const relativeToProject = this.pathMapper.toProjectRelativePath(destinationPath);
                declarations.push({
                    owner: source,
                    sourcePath: fileEntry.path.trim(),
                    targetPath: relativeToProject,
                    content: fileEntry.content,
                    executable: fileEntry.executable,
                });
                managedFiles.add(relativeToProject);
                copiedFiles += 1;
            });
        });

        return {
            managedLocalPaths: [...managedFiles].sort((a, b) => a.localeCompare(b)),
            fileHashes,
            managedFileHashes,
            declarations,
            stats: {
                declaredFiles: sourceSharedFiles.length,
                copiedFiles,
            },
            errors,
        };
    }

    /**
     * Compatibility adapter for callers that used the pre-refactor name.
     * Applying declarations is deliberately owned by ManagedFileSynchronizer.
     */
    public copySourceSharedFiles(
        input: { source: string; skillEntries: SkillEntry[]; agentSkillDirs: string[]; resolvedCommit?: string | null },
    ): SyncSharedFileCopyResult {
        return this.collectSourceSharedFiles(input);
    }
}
