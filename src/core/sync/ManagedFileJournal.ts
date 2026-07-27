import fs from 'node:fs';
import path from 'node:path';

import { hasSymlinkInPath, isPathInside } from '../filesystem/PathUtils';
import { syncExecutableBit } from '../filesystem/FilePermissions';
import type { ManagedFile } from './ManagedFileSynchronizer';

export interface ManagedFileApplyPlan {
    writes: ManagedFile[];
    removals: string[];
}

interface BackupEntry {
    targetPath: string;
    backupPath: string;
}

export default class ManagedFileJournal {
    private readonly root: string;

    public constructor({ root }: { root: string }) {
        this.root = path.resolve(root);
    }

    public apply(plan: ManagedFileApplyPlan): void {
        const journalRoot = fs.mkdtempSync(path.join(this.root, '.lsm-managed-journal-'));
        const backups: BackupEntry[] = [];
        const createdTargets: string[] = [];
        const createdDirectories: string[] = [];
        const removedDirectories: string[] = [];
        const temporaryDirectories: string[] = [];
        let backupIndex = 0;

        try {
            plan.writes.forEach((file) => {
                const targetPath = this.resolveTarget(file.targetPath);
                this.ensureSafeTarget(targetPath);
                this.ensureParentDirectory(targetPath, createdDirectories);

                const temporaryDirectory = fs.mkdtempSync(path.join(path.dirname(targetPath), '.lsm-managed-file-'));
                temporaryDirectories.push(temporaryDirectory);
                const temporaryPath = path.join(temporaryDirectory, 'content');
                fs.writeFileSync(temporaryPath, file.content);
                const existingMode = fs.existsSync(targetPath)
                    ? fs.statSync(targetPath).mode & 0o7777
                    : null;
                if (existingMode === null) {
                    syncExecutableBit(temporaryPath, file.executable);
                }
                else {
                    const nextMode = file.executable
                        ? existingMode | 0o111
                        : existingMode & ~0o111;
                    fs.chmodSync(temporaryPath, nextMode);
                }

                if (fs.existsSync(targetPath)) {
                    const backupPath = path.join(journalRoot, `backup-${String(backupIndex++)}`);
                    fs.renameSync(targetPath, backupPath);
                    backups.push({ targetPath, backupPath });
                }
                else {
                    createdTargets.push(targetPath);
                }

                fs.renameSync(temporaryPath, targetPath);
            });

            plan.removals.forEach((relativePath) => {
                const targetPath = this.resolveTarget(relativePath);
                this.ensureSafeTarget(targetPath);
                if (!fs.existsSync(targetPath)) {
                    return;
                }
                if (!fs.statSync(targetPath).isFile()) {
                    throw new Error(`Managed file target is not a file: ${relativePath}`);
                }

                const backupPath = path.join(journalRoot, `backup-${String(backupIndex++)}`);
                fs.renameSync(targetPath, backupPath);
                backups.push({ targetPath, backupPath });
                this.cleanupEmptyParents(path.dirname(targetPath), removedDirectories);
            });

            temporaryDirectories.forEach((directory) => {
                fs.rmSync(directory, { recursive: true, force: true });
            });
            fs.rmSync(journalRoot, { recursive: true, force: true });
        }
        catch (error) {
            this.cleanupTemporaryDirectories(temporaryDirectories);
            this.rollback({
                backups,
                createdTargets,
                createdDirectories,
                removedDirectories,
            });
            this.cleanupJournalRoot(journalRoot);
            throw error;
        }
    }

    private resolveTarget(relativePath: string): string {
        const normalized = relativePath.trim().replace(/\\/g, '/');
        if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
            throw new Error(`Managed file target must be a relative path: ${relativePath}`);
        }
        const segments = normalized.split('/').filter(segment => segment && segment !== '.');
        if (segments.some(segment => segment === '..')) {
            throw new Error(`Managed file target cannot contain "..": ${relativePath}`);
        }

        const targetPath = path.resolve(this.root, ...segments);
        if (!isPathInside(targetPath, this.root) || targetPath === this.root) {
            throw new Error(`Managed file target escapes project root: ${relativePath}`);
        }
        return targetPath;
    }

    private ensureSafeTarget(targetPath: string): void {
        if (hasSymlinkInPath(targetPath, this.root)) {
            throw new Error(`Managed file target contains a symbolic link: ${targetPath}`);
        }
        if (fs.existsSync(targetPath) && !fs.statSync(targetPath).isFile()) {
            throw new Error(`Managed file target is not a file: ${targetPath}`);
        }
    }

    private ensureParentDirectory(targetPath: string, createdDirectories: string[]): void {
        const parentPath = path.dirname(targetPath);
        const missing: string[] = [];
        let currentPath = parentPath;
        while (isPathInside(currentPath, this.root) && currentPath !== this.root && !fs.existsSync(currentPath)) {
            missing.push(currentPath);
            currentPath = path.dirname(currentPath);
        }
        if (hasSymlinkInPath(parentPath, this.root)) {
            throw new Error(`Managed file parent contains a symbolic link: ${parentPath}`);
        }
        fs.mkdirSync(parentPath, { recursive: true });
        missing.reverse().forEach(directory => createdDirectories.push(directory));
    }

    private cleanupEmptyParents(startPath: string, removedDirectories: string[]): void {
        let currentPath = path.resolve(startPath);
        while (isPathInside(currentPath, this.root) && currentPath !== this.root) {
            if (!fs.existsSync(currentPath) || fs.readdirSync(currentPath).length > 0) {
                break;
            }
            fs.rmdirSync(currentPath);
            removedDirectories.push(currentPath);
            currentPath = path.dirname(currentPath);
        }
    }

    private rollback({
        backups,
        createdTargets,
        createdDirectories,
        removedDirectories,
    }: {
        backups: BackupEntry[];
        createdTargets: string[];
        createdDirectories: string[];
        removedDirectories: string[];
    }): void {
        try {
            [...createdTargets].reverse().forEach((targetPath) => {
                fs.rmSync(targetPath, { force: true });
            });
            [...backups].reverse().forEach(({ targetPath, backupPath }) => {
                if (fs.existsSync(targetPath)) {
                    fs.rmSync(targetPath, { force: true });
                }
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.renameSync(backupPath, targetPath);
            });
            [...removedDirectories].reverse().forEach(directory => fs.mkdirSync(directory, { recursive: true }));
            [...createdDirectories].reverse().forEach((directory) => {
                if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
                    fs.rmdirSync(directory);
                }
            });
        }
        catch (rollbackError) {
            throw new Error(`Managed file rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: rollbackError });
        }
    }

    private cleanupTemporaryDirectories(directories: string[]): void {
        directories.forEach((directory) => {
            try {
                fs.rmSync(directory, { recursive: true, force: true });
            }
            catch {
                // Preserve the original apply error; the next run will reject unsafe leftovers.
            }
        });
    }

    private cleanupJournalRoot(journalRoot: string): void {
        try {
            fs.rmSync(journalRoot, { recursive: true, force: true });
        }
        catch {
            // Preserve the original apply error.
        }
    }
}
