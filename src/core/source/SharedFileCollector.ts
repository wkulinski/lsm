import fs from 'node:fs';
import path from 'node:path';

import { hasSymlinkInPath, isPathInside } from '../filesystem/PathUtils';
import type {
    CollectSharedFilesSuccess,
    CollectSkillDirectoriesSuccess,
    FailureResult,
    SkillDirectoryFile,
} from '../types/discovery';

interface SharedFileReadCandidateSuccess {
    ok: true;
    path: string;
    content: Buffer;
}

type SharedFileReadCandidate = SharedFileReadCandidateSuccess | FailureResult;

interface SkillDirectoryCandidateSuccess {
    ok: true;
    sourcePath: string;
    files: SkillDirectoryFile[];
}

type SkillDirectoryCandidate = SkillDirectoryCandidateSuccess | FailureResult;

export interface CollectedFileEntry {
    relativePath: string;
    absolutePath: string;
}

export default class SharedFileCollector {
    public collectSharedFiles(basePath: string, sharedFiles: string[]): CollectSharedFilesSuccess | FailureResult {
        const unique = this.sortUniq(
            (Array.isArray(sharedFiles) ? sharedFiles : [])
                .map(entry => this.normalizeRelativePath(entry, 'sharedFiles')),
        );

        const files: SharedFileReadCandidate[] = unique.map((relativePath) => {
            const absolutePath = path.resolve(basePath, relativePath);
            if (!this.isPathInside(absolutePath, basePath)) {
                return {
                    ok: false,
                    error: `Shared file path escapes source root: ${relativePath}`,
                };
            }
            if (hasSymlinkInPath(absolutePath, basePath)) {
                return {
                    ok: false,
                    error: `Shared file path contains a symbolic link: ${relativePath}`,
                };
            }
            if (!fs.existsSync(absolutePath)) {
                return {
                    ok: false,
                    error: `Shared file does not exist in source: ${relativePath}`,
                };
            }

            const stat = fs.statSync(absolutePath);
            if (!stat.isFile()) {
                return {
                    ok: false,
                    error: `Shared file path is not a file: ${relativePath}`,
                };
            }

            return {
                ok: true,
                path: relativePath,
                content: fs.readFileSync(absolutePath),
            };
        });

        const failed = files.find((entry): entry is FailureResult => !entry.ok);
        if (failed) {
            return { ok: false, error: failed.error };
        }
        const successfulFiles = files as SharedFileReadCandidateSuccess[];

        return { ok: true, files: successfulFiles.map(entry => ({ path: entry.path, content: entry.content })) };
    }

    public collectSkillDirectories(basePath: string, skillSourcePaths: string[]): CollectSkillDirectoriesSuccess | FailureResult {
        const unique = this.sortUniq(
            (Array.isArray(skillSourcePaths) ? skillSourcePaths : [])
                .map(entry => this.normalizeRelativePath(entry, 'skillSourcePaths')),
        );

        const directories: SkillDirectoryCandidate[] = unique.map((sourcePath) => {
            const absolutePath = path.resolve(basePath, sourcePath);
            if (!this.isPathInside(absolutePath, basePath)) {
                return {
                    ok: false,
                    error: `Skill path escapes source root: ${sourcePath}`,
                };
            }
            if (hasSymlinkInPath(absolutePath, basePath)) {
                return {
                    ok: false,
                    error: `Skill path contains a symbolic link: ${sourcePath}`,
                };
            }
            if (!fs.existsSync(absolutePath)) {
                return {
                    ok: false,
                    error: `Skill path does not exist in source: ${sourcePath}`,
                };
            }

            const stat = fs.statSync(absolutePath);
            if (!stat.isDirectory()) {
                return {
                    ok: false,
                    error: `Skill path is not a directory: ${sourcePath}`,
                };
            }

            const files = this.collectFilesRecursively(absolutePath).map(fileEntry => ({
                path: fileEntry.relativePath,
                content: fs.readFileSync(fileEntry.absolutePath),
            }));

            return {
                ok: true,
                sourcePath,
                files,
            };
        });

        const failed = directories.find((entry): entry is FailureResult => !entry.ok);
        if (failed) {
            return { ok: false, error: failed.error };
        }
        const successfulDirectories = directories as SkillDirectoryCandidateSuccess[];

        return {
            ok: true,
            directories: successfulDirectories.map(entry => ({
                sourcePath: entry.sourcePath,
                files: entry.files,
            })),
        };
    }

    public collectFilesRecursively(basePath: string, currentRelativePath = ''): CollectedFileEntry[] {
        const readPath = currentRelativePath ? path.join(basePath, currentRelativePath) : basePath;
        const entries = fs.readdirSync(readPath, { withFileTypes: true });
        const files: CollectedFileEntry[] = [];

        entries.forEach((entry) => {
            const nestedRelativePath = currentRelativePath
                ? path.join(currentRelativePath, entry.name)
                : entry.name;

            if (entry.isSymbolicLink()) {
                return;
            }

            if (entry.isDirectory()) {
                const nestedFiles = this.collectFilesRecursively(basePath, nestedRelativePath);
                nestedFiles.forEach(nestedFile => files.push(nestedFile));
                return;
            }

            if (!entry.isFile()) {
                return;
            }

            const normalizedRelativePath = nestedRelativePath.split(path.sep).join('/');
            files.push({
                relativePath: normalizedRelativePath,
                absolutePath: path.join(basePath, nestedRelativePath),
            });
        });

        return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }

    public normalizeRelativePath(value: unknown, fieldName: string): string {
        if (typeof value !== 'string') {
            throw new Error(`"${fieldName}" must be a string`);
        }

        const normalizedSlashes = value.trim().replace(/\\/g, '/');
        if (!normalizedSlashes) {
            throw new Error(`"${fieldName}" cannot be empty`);
        }

        if (normalizedSlashes.startsWith('/') || /^[A-Za-z]:\//.test(normalizedSlashes)) {
            throw new Error(`"${fieldName}" must be a relative path`);
        }

        const tokens = normalizedSlashes
            .split('/')
            .filter(token => token.length > 0 && token !== '.');

        if (tokens.some(token => token === '..')) {
            throw new Error(`"${fieldName}" cannot contain ".."`);
        }

        return tokens.length > 0 ? tokens.join('/') : '.';
    }

    public isPathInside(candidatePath: string, rootPath: string): boolean {
        return isPathInside(candidatePath, rootPath);
    }

    private sortUniq(arr: string[]): string[] {
        return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
    }
}
