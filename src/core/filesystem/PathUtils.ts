import fs from 'node:fs';
import path from 'node:path';

export function normalizePosixPath(value: unknown): string {
    return typeof value === 'string'
        ? value.replace(/\\/g, '/')
        : '';
}

export function toPosixPath(value: string): string {
    return value.split(path.sep).join('/');
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return !(relative.startsWith('..') || path.isAbsolute(relative));
}

export function hasSymlinkInPath(candidatePath: string, rootPath: string): boolean {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedCandidate = path.resolve(candidatePath);
    if (!isPathInside(resolvedCandidate, resolvedRoot)) {
        return true;
    }

    let currentPath = resolvedRoot;
    const relativePath = path.relative(resolvedRoot, resolvedCandidate);
    const segments = relativePath ? relativePath.split(path.sep) : [];

    for (const segment of segments) {
        currentPath = path.join(currentPath, segment);
        if (isSymbolicLink(currentPath)) {
            return true;
        }
    }

    return false;
}

function isSymbolicLink(filePath: string): boolean {
    try {
        return fs.lstatSync(filePath).isSymbolicLink();
    }
    catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
}

export function extractSkillsRootPrefix(sourcePath: unknown): string | null {
    const normalized = typeof sourcePath === 'string'
        ? normalizePosixPath(sourcePath.trim())
        : '';
    if (!normalized) {
        return null;
    }

    const parts = normalized.split('/').filter(Boolean);
    const index = parts.lastIndexOf('skills');
    if (index === -1) {
        return null;
    }

    return parts.slice(0, index + 1).join('/');
}

export function relativeToSkillsRoot(sourcePath: unknown, skillsRootPrefix: unknown): string | null {
    const normalizedPath = typeof sourcePath === 'string'
        ? normalizePosixPath(sourcePath.trim())
        : '';
    const normalizedRoot = typeof skillsRootPrefix === 'string'
        ? normalizePosixPath(skillsRootPrefix.trim())
        : '';
    if (!normalizedPath || !normalizedRoot) {
        return null;
    }

    const prefix = `${normalizedRoot}/`;
    if (!normalizedPath.startsWith(prefix)) {
        return null;
    }

    const relativePath = normalizedPath.slice(prefix.length);
    return relativePath || null;
}
