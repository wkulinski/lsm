import fs from 'node:fs';
import path from 'node:path';

import Helpers from '../shared/Helpers';
import { syncExecutableBit } from '../filesystem/FilePermissions';
import { SWAP_DIRECTORY_PREFIX } from '../filesystem/PathUtils';

interface SkillInstallerFileEntry {
    path: string;
    content: Buffer | string;
    executable: boolean;
}

export default class SkillInstaller {
    public static writeDirectory(targetDir: string, files: SkillInstallerFileEntry[], boundaryDir: string): void {
        const resolvedTargetDir = path.resolve(targetDir);
        const resolvedBoundaryDir = path.resolve(boundaryDir);
        if (resolvedTargetDir === resolvedBoundaryDir || !SkillInstaller.isPathInsideRoot(resolvedTargetDir, resolvedBoundaryDir)) {
            Helpers.die(`Skill target directory escapes skills directory: ${targetDir}`);
        }

        const stagedFiles = SkillInstaller.validateFiles(resolvedTargetDir, files);

        const workDir = SkillInstaller.createWorkDirectory(resolvedBoundaryDir);

        try {
            SkillInstaller.installThrough(workDir, resolvedTargetDir, stagedFiles);
        }
        catch (error) {
            // The skills directory is on another volume than its parent (for example a mount point),
            // so the swap cannot rename across them. Nothing was moved; retry from inside it.
            if (!SkillInstaller.isCrossDeviceError(error) || path.dirname(workDir) === resolvedBoundaryDir) {
                throw error;
            }
            SkillInstaller.installThrough(SkillInstaller.createWorkDirectoryIn(resolvedBoundaryDir), resolvedTargetDir, stagedFiles);
        }
    }

    private static installThrough(workDir: string, targetDir: string, files: SkillInstallerFileEntry[]): void {
        try {
            const preparedDir = path.join(workDir, 'new');
            SkillInstaller.prepareDirectory(preparedDir, files);
            SkillInstaller.replaceDirectory(targetDir, preparedDir, path.join(workDir, 'previous'));
        }
        catch (error) {
            if (fs.existsSync(path.join(workDir, 'previous'))) {
                // Restoration failed: the previous version is only available in the work directory.
                throw error;
            }
            SkillInstaller.removeQuietly(workDir);
            throw error;
        }

        SkillInstaller.removeQuietly(workDir);
    }

    // The work directory lives next to the skills directory: outside every directory that agents or
    // local discovery read skills from. When that parent is not writable, or is on another volume,
    // it falls back to a prefixed directory inside the skills directory, which scanners skip.
    private static createWorkDirectory(skillsDir: string): string {
        try {
            return SkillInstaller.createWorkDirectoryIn(path.dirname(skillsDir));
        }
        catch {
            return SkillInstaller.createWorkDirectoryIn(skillsDir);
        }
    }

    private static createWorkDirectoryIn(baseDir: string): string {
        fs.mkdirSync(baseDir, { recursive: true });
        return fs.mkdtempSync(path.join(baseDir, SWAP_DIRECTORY_PREFIX));
    }

    private static isCrossDeviceError(error: unknown): boolean {
        return (error as NodeJS.ErrnoException | undefined)?.code === 'EXDEV';
    }

    private static validateFiles(targetDir: string, files: SkillInstallerFileEntry[]): SkillInstallerFileEntry[] {
        return (Array.isArray(files) ? files : []).map((fileEntry) => {
            const relativePath = SkillInstaller.normalizeRelativePath(fileEntry.path, 'files.path');
            const destinationPath = path.resolve(targetDir, relativePath);
            if (!SkillInstaller.isPathInsideRoot(destinationPath, targetDir)) {
                Helpers.die(`Skill file path escapes target directory: ${relativePath}`);
            }

            return { ...fileEntry, path: relativePath };
        });
    }

    private static prepareDirectory(preparedDir: string, files: SkillInstallerFileEntry[]): void {
        fs.mkdirSync(preparedDir, { recursive: true });

        files.forEach((fileEntry) => {
            const destinationPath = path.resolve(preparedDir, fileEntry.path);
            fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
            fs.writeFileSync(destinationPath, fileEntry.content);
            syncExecutableBit(destinationPath, fileEntry.executable);
        });
    }

    private static replaceDirectory(targetDir: string, preparedDir: string, backupDir: string): void {
        const hadPrevious = fs.existsSync(targetDir);
        if (hadPrevious) {
            fs.renameSync(targetDir, backupDir);
        }

        try {
            fs.mkdirSync(path.dirname(targetDir), { recursive: true });
            fs.renameSync(preparedDir, targetDir);
        }
        catch (error) {
            if (hadPrevious) {
                SkillInstaller.restoreDirectory(targetDir, backupDir, error);
            }
            throw error;
        }
    }

    private static restoreDirectory(targetDir: string, backupDir: string, cause: unknown): void {
        try {
            fs.rmSync(targetDir, { recursive: true, force: true });
            fs.renameSync(backupDir, targetDir);
        }
        catch (restoreError) {
            const causeMessage = cause instanceof Error ? cause.message : String(cause);
            const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
            Helpers.die(`Failed to replace skill directory (${causeMessage}) and to restore the previous version (${restoreMessage}). Previous version is preserved at: ${backupDir}`);
        }
    }

    private static removeQuietly(directoryPath: string): void {
        try {
            fs.rmSync(directoryPath, { recursive: true, force: true });
        }
        catch {
            // A leftover work directory is harmless and is not a skill directory.
        }
    }

    public static removeDirectory(targetDir: string, boundaryDir: string): void {
        if (!fs.existsSync(targetDir)) {
            return;
        }

        const stat = fs.statSync(targetDir);
        if (!stat.isDirectory()) {
            Helpers.die(`Managed skill path is not a directory: ${targetDir}`);
        }

        fs.rmSync(targetDir, { recursive: true, force: true });
        SkillInstaller.cleanupEmptyParents(path.dirname(targetDir), boundaryDir);
    }

    public static cleanupEmptyParents(startDirectoryPath: string, boundaryDir: string): void {
        let currentDirectoryPath = path.resolve(startDirectoryPath);
        const resolvedBoundaryDir = path.resolve(boundaryDir);

        while (SkillInstaller.isPathInsideRoot(currentDirectoryPath, resolvedBoundaryDir) && currentDirectoryPath !== resolvedBoundaryDir) {
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

    public static normalizeRelativePath(value: unknown, fieldName: string): string {
        if (typeof value !== 'string') {
            Helpers.die(`"${fieldName}" must be a string`);
        }

        const normalizedSlashes = value.trim().replace(/\\/g, '/');
        if (!normalizedSlashes) {
            Helpers.die(`"${fieldName}" cannot be empty`);
        }

        if (normalizedSlashes.startsWith('/') || /^[A-Za-z]:\//.test(normalizedSlashes)) {
            Helpers.die(`"${fieldName}" must be a relative path`);
        }

        const tokens = normalizedSlashes
            .split('/')
            .filter(token => token.length > 0 && token !== '.');

        if (tokens.some(token => token === '..')) {
            Helpers.die(`"${fieldName}" cannot contain ".."`);
        }

        return tokens.length > 0 ? tokens.join('/') : '.';
    }

    public static isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
        const relative = path.relative(rootPath, candidatePath);
        return !(relative.startsWith('..') || path.isAbsolute(relative));
    }
}
