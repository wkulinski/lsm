import path from 'node:path';

import FileSystem from './FileSystem';
import { isPathInside, normalizePosixPath } from './PathUtils';

export interface CollectedDirectoryFile {
    absolutePath: string;
    relativePath: string;
}

export default class DirectoryCopier {
    private readonly fileSystem: FileSystem;

    public constructor({ fileSystem = new FileSystem() }: { fileSystem?: FileSystem } = {}) {
        this.fileSystem = fileSystem;
    }

    public copyDirectory({ sourceDir, cloneDir, targetBasePath }: {
        sourceDir: string;
        cloneDir: string;
        targetBasePath: string;
    }): string[] {
        const copied: string[] = [];
        this.collectFilesRecursively(sourceDir).forEach((fileEntry) => {
            const relativeTargetPath = normalizePosixPath(path.posix.join(targetBasePath, fileEntry.relativePath));
            const destinationPath = path.resolve(cloneDir, relativeTargetPath);
            if (!isPathInside(destinationPath, cloneDir)) {
                return;
            }
            if (this.fileSystem.hasSymlinkInPath(destinationPath, cloneDir)) {
                throw new Error(`Publish target path contains a symbolic link: ${relativeTargetPath}`);
            }

            this.fileSystem.ensureParentDirectory(destinationPath);
            this.fileSystem.copyFile(fileEntry.absolutePath, destinationPath);
            copied.push(relativeTargetPath);
        });

        return copied;
    }

    public collectFilesRecursively(basePath: string, currentRelativePath = ''): CollectedDirectoryFile[] {
        const currentPath = currentRelativePath ? path.join(basePath, currentRelativePath) : basePath;
        const files: CollectedDirectoryFile[] = [];

        this.fileSystem.readDirectory(currentPath).forEach((entry) => {
            const nestedRelativePath = currentRelativePath
                ? path.join(currentRelativePath, entry.name)
                : entry.name;

            if (entry.isSymbolicLink()) {
                return;
            }

            if (entry.isDirectory()) {
                files.push(...this.collectFilesRecursively(basePath, nestedRelativePath));
                return;
            }

            if (!entry.isFile()) {
                return;
            }

            files.push({
                absolutePath: path.join(basePath, nestedRelativePath),
                relativePath: normalizePosixPath(nestedRelativePath),
            });
        });

        return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }
}
