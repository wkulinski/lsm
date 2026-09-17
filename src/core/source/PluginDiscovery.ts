import fs from 'node:fs';
import path from 'node:path';

import { hasExecutableBit } from '../filesystem/FilePermissions';
import { hasSymlinkInPath, isPathInside, toPosixPath } from '../filesystem/PathUtils';
import Hashing from '../shared/Hashing';
import type {
    FailureResult,
    PluginDefinition,
    PluginDiscoverySuccess,
} from '../types/discovery';
import type { SourceWorkspaceHandle } from './SourceWorkspace';

const PLUGIN_DIRECTORY = '.opencode/plugins';

interface CollectedPluginFile {
    absolutePath: string;
    sourcePath: string;
}

export default class PluginDiscovery {
    public discoverWorkspace(workspace: SourceWorkspaceHandle): PluginDiscoverySuccess | FailureResult {
        const sourceRoot = this.resolveSourceRoot(workspace);
        const pluginDirectory = path.resolve(sourceRoot, PLUGIN_DIRECTORY);
        const directoryStat = this.readDirectoryStat(pluginDirectory);

        if (!directoryStat) {
            return { ok: true, plugins: [] };
        }
        if (directoryStat.isSymbolicLink() || hasSymlinkInPath(pluginDirectory, sourceRoot)) {
            throw new Error(`Plugin directory contains a symbolic link: ${PLUGIN_DIRECTORY}`);
        }
        if (!directoryStat.isDirectory()) {
            throw new Error(`Plugin directory path is not a directory: ${PLUGIN_DIRECTORY}`);
        }

        const files = this.collectFiles(sourceRoot, pluginDirectory);

        return {
            ok: true,
            plugins: files.map(file => this.createDefinition(file)),
        };
    }

    private resolveSourceRoot(workspace: SourceWorkspaceHandle): string {
        const workspaceRoot = path.resolve(workspace.root);
        const sourceRoot = path.resolve(workspaceRoot, workspace.resolved.subpath ?? '.');
        if (!isPathInside(sourceRoot, workspaceRoot)) {
            throw new Error(`Plugin source subpath escapes workspace root: ${workspace.resolved.subpath ?? '.'}`);
        }
        if (hasSymlinkInPath(sourceRoot, workspaceRoot)) {
            throw new Error(`Plugin source subpath contains a symbolic link: ${workspace.resolved.subpath ?? '.'}`);
        }

        return sourceRoot;
    }

    private readDirectoryStat(directoryPath: string): fs.Stats | null {
        try {
            return fs.lstatSync(directoryPath);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    private collectFiles(sourceRoot: string, directoryPath: string, currentRelativePath = PLUGIN_DIRECTORY): CollectedPluginFile[] {
        const files: CollectedPluginFile[] = [];
        const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));

        entries.forEach((entry) => {
            const filePath = path.join(directoryPath, entry.name);
            const relativePath = `${currentRelativePath}/${entry.name}`;
            if (entry.isSymbolicLink()) {
                throw new Error(`Plugin path contains a symbolic link: ${toPosixPath(relativePath)}`);
            }
            if (!isPathInside(filePath, sourceRoot)) {
                throw new Error(`Plugin path escapes source root: ${toPosixPath(relativePath)}`);
            }
            if (entry.isDirectory()) {
                files.push(...this.collectFiles(sourceRoot, filePath, relativePath));
                return;
            }
            if (!entry.isFile()) {
                return;
            }

            const normalizedPath = this.normalizeRelativePath(path.relative(sourceRoot, filePath));
            const stat = fs.lstatSync(filePath);
            if (stat.isSymbolicLink()) {
                throw new Error(`Plugin path contains a symbolic link: ${normalizedPath}`);
            }
            if (!stat.isFile()) {
                return;
            }
            files.push({ absolutePath: filePath, sourcePath: normalizedPath });
        });

        return files.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
    }

    private createDefinition(file: CollectedPluginFile): PluginDefinition {
        const content = fs.readFileSync(file.absolutePath);
        const stat = fs.lstatSync(file.absolutePath);

        if (stat.isSymbolicLink()) {
            throw new Error(`Plugin path contains a symbolic link: ${file.sourcePath}`);
        }

        return {
            sourcePath: file.sourcePath,
            targetPath: file.sourcePath,
            content,
            hash: {
                sha256: Hashing.sha256Buffer(content),
                executable: hasExecutableBit(stat.mode),
            },
        };
    }

    private normalizeRelativePath(value: string): string {
        const normalized = toPosixPath(value).trim();
        if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
            throw new Error(`Plugin path must be a relative path: ${value}`);
        }

        const parts = normalized.split('/').filter(part => part && part !== '.');
        if (parts.some(part => part === '..')) {
            throw new Error(`Plugin path cannot contain "..": ${value}`);
        }

        return parts.join('/');
    }
}
