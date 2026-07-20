import path from 'node:path';

import DirectoryCopier from '../filesystem/DirectoryCopier';
import FileSystem from '../filesystem/FileSystem';
import { isPathInside } from '../filesystem/PathUtils';
import GitRunner, { type GitCommandResult } from '../git/GitRunner';
import type { ManifestPublishConfig, ResolvedSource } from '../types';
import type { PublishErrorResult } from './PublishParameterResolver';
import type { PublishPlanItem } from './PublishPlanBuilder';
import PublishPathMapper from './PublishPathMapper';

export interface ChangedFile {
    status: string;
    path: string;
}

export type PublishGitResult = GitCommandResult;

export type PublishGitRunner = (cwd: string, args: string[]) => PublishGitResult;

export interface CloneRepoSuccess {
    ok: true;
    dir: string;
}

export interface CloneRepoFailure {
    ok: false;
    error: string;
    details?: string;
}

export interface PrepareWorkspaceSuccess {
    ok: true;
    cloneDir: string;
    branchName: string;
}

export type StagePublishPlanResult
    = | { ok: true; result: { message: string }; changedFiles?: never }
        | { ok: true; changedFiles: ChangedFile[]; result?: never }
        | PublishErrorResult;

export default class PublishWorkspace {
    private readonly gitRunner: PublishGitRunner;
    private readonly pathMapper: PublishPathMapper;
    private readonly fileSystem: FileSystem;
    private readonly directoryCopier: DirectoryCopier;

    public constructor({
        gitRunner = defaultGitRunner,
        pathMapper = new PublishPathMapper(),
        fileSystem = new FileSystem(),
        directoryCopier = new DirectoryCopier({ fileSystem }),
    }: {
        gitRunner?: PublishGitRunner;
        pathMapper?: PublishPathMapper;
        fileSystem?: FileSystem;
        directoryCopier?: DirectoryCopier;
    } = {}) {
        this.gitRunner = gitRunner;
        this.pathMapper = pathMapper;
        this.fileSystem = fileSystem;
        this.directoryCopier = directoryCopier;
    }

    public preparePublishWorkspace({
        sourceInfo, resolvedCommit, branch, publishConfig,
    }: {
        sourceInfo: ResolvedSource;
        resolvedCommit: string;
        branch: string | null;
        publishConfig: ManifestPublishConfig;
    }): PrepareWorkspaceSuccess | PublishErrorResult {
        const cloned = this.cloneRepository(sourceInfo.url);
        if (!cloned.ok) {
            return cloned;
        }

        const cloneDir = cloned.dir;
        const hasCommit = this.git(cloneDir, ['cat-file', '-e', `${resolvedCommit}^{commit}`]).ok;
        if (!hasCommit) {
            this.cleanupTempDir(cloneDir);
            return {
                ok: false,
                error: `Commit ${resolvedCommit} not found in source history.`,
            };
        }

        const branchName = branch && branch.trim().length > 0
            ? branch
            : this.defaultBranchName(resolvedCommit, publishConfig.branchPrefix);
        const checkout = this.git(cloneDir, ['checkout', '-b', branchName, resolvedCommit]);
        if (!checkout.ok) {
            this.cleanupTempDir(cloneDir);
            return {
                ok: false,
                error: `Failed to create publish branch "${branchName}" from ${resolvedCommit}.`,
            };
        }

        return { ok: true, cloneDir, branchName };
    }

    public stagePublishPlan({
        cloneDir, planItems,
    }: {
        cloneDir: string;
        planItems: PublishPlanItem[];
    }): StagePublishPlanResult {
        const stagedPaths = this.applyPlan(planItems, cloneDir);
        if (stagedPaths.length === 0) {
            return {
                ok: true,
                result: { message: 'No file changes detected after applying publish plan.' },
            };
        }

        // Publish plans contain only explicitly managed, path-validated files.
        // Force-add is required when a source repository intentionally ignores
        // its skills directory (for example /.agents/skills/).
        const addResult = this.git(cloneDir, ['add', '-f', '--', ...stagedPaths]);
        if (!addResult.ok) {
            return {
                ok: false,
                error: 'Failed to stage publish changes.',
                details: addResult.stderr || addResult.stdout,
            };
        }

        const changedFiles = this.readChangedFiles(cloneDir);
        if (changedFiles.length === 0) {
            return {
                ok: true,
                result: { message: 'No git changes detected after staging publish plan.' },
            };
        }

        return { ok: true, changedFiles };
    }

    public cloneRepository(url: string): CloneRepoSuccess | CloneRepoFailure {
        const tempDir = this.fileSystem.createTempDirectory('skills-publish-');
        const res = this.git('', ['clone', url, tempDir]);
        if (res.errorCode === 'ENOENT') {
            this.cleanupTempDir(tempDir);
            return { ok: false, error: 'git not found in PATH' };
        }

        if (!res.ok) {
            this.cleanupTempDir(tempDir);
            return {
                ok: false,
                error: `Git clone failed (exit=${String(res.status)})`,
                details: res.stderr || res.stdout,
            };
        }

        return { ok: true, dir: tempDir };
    }

    public applyPlan(items: PublishPlanItem[], cloneDir: string): string[] {
        const stagedPaths = new Set<string>();
        items.forEach((item: PublishPlanItem) => {
            if (item.type === 'directory') {
                const copiedFiles = this.copyDirectory({
                    sourceDir: item.localPath,
                    cloneDir,
                    targetBasePath: item.targetPath,
                });
                copiedFiles.forEach(relativeFilePath => stagedPaths.add(relativeFilePath));
                return;
            }

            if (item.type === 'delete') {
                const targetPath = this.pathMapper.normalizePosix(item.targetPath);
                const destination = path.resolve(cloneDir, targetPath);
                if (!isPathInside(destination, cloneDir)) {
                    return;
                }
                if (this.fileSystem.hasSymlinkInPath(destination, cloneDir)) {
                    throw new Error(`Publish target path contains a symbolic link: ${targetPath}`);
                }
                if (!this.fileSystem.exists(destination)) {
                    return;
                }
                const destinationStat = this.fileSystem.lstat(destination);
                const deleteKind = item.deleteKind === 'directory' ? 'directory' : 'file';
                if (deleteKind === 'directory' && !destinationStat.isDirectory()) {
                    return;
                }
                if (deleteKind === 'file' && !destinationStat.isFile()) {
                    return;
                }
                this.fileSystem.remove(destination, deleteKind === 'directory');
                this.fileSystem.cleanupEmptyParents(path.dirname(destination), cloneDir);
                stagedPaths.add(targetPath);
                return;
            }

            const targetPath = this.pathMapper.normalizePosix(item.targetPath);
            const destination = path.resolve(cloneDir, targetPath);
            if (!isPathInside(destination, cloneDir)) {
                return;
            }
            if (this.fileSystem.hasSymlinkInPath(destination, cloneDir)) {
                throw new Error(`Publish target path contains a symbolic link: ${targetPath}`);
            }
            this.fileSystem.ensureParentDirectory(destination);
            this.fileSystem.copyFile(item.localPath, destination);
            stagedPaths.add(targetPath);
        });

        return [...stagedPaths].sort((a, b) => a.localeCompare(b));
    }

    public copyDirectory({ sourceDir, cloneDir, targetBasePath }: { sourceDir: string; cloneDir: string; targetBasePath: string }): string[] {
        return this.directoryCopier.copyDirectory({ sourceDir, cloneDir, targetBasePath });
    }

    public collectFilesRecursively(basePath: string, currentRelativePath = ''): { absolutePath: string; relativePath: string }[] {
        return this.directoryCopier.collectFilesRecursively(basePath, currentRelativePath);
    }

    public readChangedFiles(cwd: string): ChangedFile[] {
        const result = this.git(cwd, ['diff', '--cached', '--name-status']);
        if (!result.ok) {
            return [];
        }

        return result.stdout
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map((line) => {
                const [status, ...rest] = line.split(/\s+/);
                return {
                    status,
                    path: rest.join(' '),
                };
            });
    }

    public defaultBranchName(resolvedCommit: string, prefix: string | null = null): string {
        const branchPrefix = (typeof prefix === 'string' && prefix.trim())
            ? prefix.trim().replace(/\/+$/, '')
            : 'skills-sync/publish';
        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
        return `${branchPrefix}-${timestamp}-${resolvedCommit.slice(0, 8)}`;
    }

    public git(cwd: string, args: string[]): PublishGitResult {
        return this.gitRunner(cwd, args);
    }

    public ensureParentDirectory(filePath: string): void {
        this.fileSystem.ensureParentDirectory(filePath);
    }

    public cleanupEmptyParents(startDirectoryPath: string, rootPath: string): void {
        this.fileSystem.cleanupEmptyParents(startDirectoryPath, rootPath);
    }

    public cleanupTempDir(dir: string | null | undefined): void {
        this.fileSystem.cleanupTempDir(dir);
    }
}

function defaultGitRunner(cwd: string, args: string[]): PublishGitResult {
    return new GitRunner().run(cwd, args);
}
