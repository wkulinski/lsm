import fs from 'node:fs';
import path from 'node:path';

import { hasExecutableBit } from '../filesystem/FilePermissions';
import { hasSymlinkInPath, isPathInside, toPosixPath } from '../filesystem/PathUtils';
import Hashing from '../shared/Hashing';
import type { SkillDefinition } from '../types/discovery';
import type { FileHashEntry, ManagedFileHashEntry, SkillEntry } from '../types/manifest';

export interface SkillCatalog {
    skillNames: string[];
    skillEntries: SkillEntry[];
    sharedFileHashes: FileHashEntry[];
    managedSharedFileHashes: ManagedFileHashEntry[];
}

export default class SkillCatalogBuilder {
    public build(basePath: string, skills: SkillDefinition[]): SkillCatalog {
        const skillEntries = skills
            .map(skill => ({
                name: skill.name,
                sourcePath: toPosixPath(path.relative(basePath, skill.path)),
                sharedFiles: this.sortUniq(skill.sharedFiles),
                hash: Hashing.hashDirectory(skill.path),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const sharedFileHashes = this.sortUniq(
            skillEntries.flatMap(entry => entry.sharedFiles),
        ).map(sharedFilePath => this.hashSharedFile(basePath, sharedFilePath));
        const managedSharedFileHashes = this.sortUniq(
            skillEntries.flatMap(entry => entry.sharedFiles),
        ).map(sharedFilePath => this.hashManagedSharedFile(basePath, sharedFilePath));

        return {
            skillNames: this.sortUniq(skills.map(skill => skill.name)),
            skillEntries,
            sharedFileHashes,
            managedSharedFileHashes,
        };
    }

    public hashSharedFile(basePath: string, sharedFilePath: string): FileHashEntry {
        const absolutePath = path.resolve(basePath, sharedFilePath);
        if (!isPathInside(absolutePath, basePath)) {
            throw new Error(`Shared file path escapes source root while hashing: ${sharedFilePath}`);
        }
        if (hasSymlinkInPath(absolutePath, basePath)) {
            throw new Error(`Shared file path contains a symbolic link while hashing: ${sharedFilePath}`);
        }
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
            throw new Error(`Shared file does not exist while hashing: ${sharedFilePath}`);
        }

        return {
            path: sharedFilePath,
            sha256: Hashing.sha256File(absolutePath),
        };
    }

    public hashManagedSharedFile(basePath: string, sharedFilePath: string): ManagedFileHashEntry {
        const absolutePath = path.resolve(basePath, sharedFilePath);
        if (!isPathInside(absolutePath, basePath)) {
            throw new Error(`Shared file path escapes source root while hashing: ${sharedFilePath}`);
        }
        if (hasSymlinkInPath(absolutePath, basePath)) {
            throw new Error(`Shared file path contains a symbolic link while hashing: ${sharedFilePath}`);
        }
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
            throw new Error(`Shared file does not exist while hashing: ${sharedFilePath}`);
        }

        const stat = fs.statSync(absolutePath);
        return {
            path: sharedFilePath,
            hash: {
                sha256: Hashing.sha256File(absolutePath),
                executable: hasExecutableBit(stat.mode),
            },
        };
    }

    private sortUniq(arr: string[]): string[] {
        return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
    }
}
