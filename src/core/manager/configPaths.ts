import path from 'node:path';

export function resolveConfigPath(candidate: string | undefined, fallback: string, root: string): string {
    if (!candidate) {
        return fallback;
    }

    return path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
}

export function resolveManifestPath(root: string, candidate?: string): string {
    return resolveConfigPath(candidate, path.join(root, 'skills.json'), root);
}

export function resolveLockPath(root: string, candidate?: string): string {
    return resolveConfigPath(candidate, path.join(root, 'skills.lock.json'), root);
}
