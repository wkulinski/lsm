import fs from 'node:fs';
import path from 'node:path';

import { hasSymlinkInPath, isPathInside, toPosixPath } from '../filesystem/PathUtils';
import Hashing from '../shared/Hashing';
import type { SkillDefinition } from '../types/discovery';
import type { FileHashEntry, SkillEntry } from '../types/manifest';

export interface SkillCatalog {
    skillNames: string[];
    skillEntries: SkillEntry[];
    sharedFileHashes: FileHashEntry[];
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

        return {
            skillNames: this.sortUniq(skills.map(skill => skill.name)),
            skillEntries,
            sharedFileHashes,
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

    private sortUniq(arr: string[]): string[] {
        return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
    }
}
