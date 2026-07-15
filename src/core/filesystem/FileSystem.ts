import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hasSymlinkInPath, isPathInside } from './PathUtils';

export default class FileSystem {
    public createTempDirectory(prefix: string): string {
        return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    }

    public exists(filePath: string): boolean {
        return fs.existsSync(filePath);
    }

    public stat(filePath: string): fs.Stats {
        return fs.statSync(filePath);
    }

    public lstat(filePath: string): fs.Stats {
        return fs.lstatSync(filePath);
    }

    public readFile(filePath: string): Buffer {
        return fs.readFileSync(filePath);
    }

    public readDirectory(directoryPath: string): fs.Dirent[] {
        return fs.readdirSync(directoryPath, { withFileTypes: true });
    }

    public makeDirectory(directoryPath: string): void {
        fs.mkdirSync(directoryPath, { recursive: true });
    }

    public copyFile(sourcePath: string, destinationPath: string): void {
        fs.copyFileSync(sourcePath, destinationPath);
    }

    public remove(filePath: string, recursive = false): void {
        fs.rmSync(filePath, { recursive, force: true });
    }

    public removeEmptyDirectory(directoryPath: string): void {
        fs.rmdirSync(directoryPath);
    }

    public hasSymlinkInPath(candidatePath: string, rootPath: string): boolean {
        return hasSymlinkInPath(candidatePath, rootPath);
    }

    public ensureParentDirectory(filePath: string): void {
        const parent = path.dirname(filePath);
        if (!this.exists(parent)) {
            this.makeDirectory(parent);
        }
    }

    public cleanupEmptyParents(startDirectoryPath: string, rootPath: string): void {
        let currentDirectoryPath = path.resolve(startDirectoryPath);
        const normalizedRootPath = path.resolve(rootPath);

        while (isPathInside(currentDirectoryPath, normalizedRootPath) && currentDirectoryPath !== normalizedRootPath) {
            if (!this.exists(currentDirectoryPath)) {
                currentDirectoryPath = path.dirname(currentDirectoryPath);
                continue;
            }

            if (this.readDirectory(currentDirectoryPath).length > 0) {
                break;
            }

            this.removeEmptyDirectory(currentDirectoryPath);
            currentDirectoryPath = path.dirname(currentDirectoryPath);
        }
    }

    public cleanupTempDir(directoryPath: string | null | undefined): void {
        if (!directoryPath) {
            return;
        }

        try {
            this.remove(directoryPath, true);
        }
        catch {
            // best-effort cleanup
        }
    }
}
