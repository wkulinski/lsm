import fs from 'node:fs';
import path from 'node:path';

import { normalizePosixPath } from '../filesystem/PathUtils';

export type SubagentDirectoryVariant = 'agent' | 'agents';

export interface SubagentDirectory {
    variant: SubagentDirectoryVariant;
    relativePath: string;
    absolutePath: string;
}

const VARIANTS: SubagentDirectoryVariant[] = ['agent', 'agents'];

export default class SubagentRegistry {
    public sourceDirectories(sourceRoot: string): SubagentDirectory[] {
        return this.existingDirectories(sourceRoot);
    }

    public projectDirectories(projectRoot: string): SubagentDirectory[] {
        const existing = this.existingDirectories(projectRoot);
        if (existing.length > 0) {
            return existing;
        }

        return [this.createDirectory(projectRoot, 'agents')];
    }

    public resolveTargetPath({
        sourcePath,
        projectRoot,
        mode = 'update',
        lockedTargetPath,
    }: {
        sourcePath: string;
        projectRoot?: string;
        mode?: 'update' | 'locked';
        lockedTargetPath?: string | null;
    }): string {
        if (mode === 'locked') {
            if (!lockedTargetPath) {
                throw new Error(`Missing locked targetPath for subagent: ${sourcePath}`);
            }
            return this.normalizeTargetPath(lockedTargetPath);
        }
        if (!projectRoot) {
            throw new Error('projectRoot is required to resolve a subagent targetPath.');
        }

        const normalizedSourcePath = this.normalizeSourcePath(sourcePath);
        const sourceVariant = VARIANTS.find(variant => normalizedSourcePath.startsWith(`.opencode/${variant}/`));
        if (!sourceVariant) {
            throw new Error(`Subagent source path must be inside .opencode/agent or .opencode/agents: ${sourcePath}`);
        }

        const sourceRelativePath = normalizedSourcePath.slice(`.opencode/${sourceVariant}/`.length);
        const projectDirectories = this.projectDirectories(projectRoot);
        const targetDirectory = projectDirectories.find(directory => directory.variant === sourceVariant)
            ?? (projectDirectories.length === 1 ? projectDirectories[0] : projectDirectories.find(directory => directory.variant === 'agents'));
        if (!targetDirectory) {
            throw new Error(`Unable to resolve a project subagent directory for: ${sourcePath}`);
        }

        return normalizePosixPath(path.posix.join(targetDirectory.relativePath, sourceRelativePath));
    }

    public normalizeSourcePath(value: string): string {
        const normalized = this.normalizeRelativePath(value, 'sourcePath');
        if (!VARIANTS.some(variant => normalized.startsWith(`.opencode/${variant}/`))) {
            throw new Error(`Subagent source path must be inside .opencode/agent or .opencode/agents: ${value}`);
        }
        return normalized;
    }

    public normalizeTargetPath(value: string): string {
        const normalized = this.normalizeRelativePath(value, 'targetPath');
        if (!VARIANTS.some(variant => normalized.startsWith(`.opencode/${variant}/`))) {
            throw new Error(`Subagent target path must be inside .opencode/agent or .opencode/agents: ${value}`);
        }
        return normalized;
    }

    private existingDirectories(root: string): SubagentDirectory[] {
        return VARIANTS
            .filter((variant) => {
                const directoryPath = path.join(root, '.opencode', variant);
                try {
                    const stat = fs.lstatSync(directoryPath);
                    if (stat.isDirectory() || stat.isSymbolicLink()) {
                        return true;
                    }
                    throw new Error(`Subagent directory path is not a directory: .opencode/${variant}`);
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                        return false;
                    }
                    throw error;
                }
            })
            .map(variant => this.createDirectory(root, variant));
    }

    private createDirectory(root: string, variant: SubagentDirectoryVariant): SubagentDirectory {
        return {
            variant,
            relativePath: `.opencode/${variant}`,
            absolutePath: path.resolve(root, '.opencode', variant),
        };
    }

    private normalizeRelativePath(value: unknown, fieldName: string): string {
        if (typeof value !== 'string') {
            throw new Error(`"${fieldName}" must be a string`);
        }

        const trimmed = value.trim();
        if (trimmed.includes('\\')) {
            throw new Error(`"${fieldName}" must use POSIX separators`);
        }
        const normalized = trimmed;
        if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
            throw new Error(`"${fieldName}" must be a relative path`);
        }

        const parts = normalized.split('/').filter(part => part && part !== '.');
        if (parts.some(part => part === '..')) {
            throw new Error(`"${fieldName}" cannot contain ".."`);
        }

        return parts.join('/');
    }
}
