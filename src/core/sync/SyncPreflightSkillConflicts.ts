import fs from 'node:fs';
import path from 'node:path';

import Helpers from '../shared/Helpers';
import Hashing, { type DirectoryFileHash, type DirectoryHash } from '../shared/Hashing';
import SyncPathMapper from './SyncPathMapper';
import type SyncPreflightConflictSet from './SyncPreflightConflictSet';
import type {
    BackendLike,
    SkillEntry,
} from '../types';

export default class SyncPreflightSkillConflicts {
    private readonly pathMapper: SyncPathMapper;

    public constructor({ backend, pathMapper }: { backend: BackendLike; pathMapper?: SyncPathMapper }) {
        this.pathMapper = pathMapper ?? new SyncPathMapper({ backend });
    }

    public collectSkillDirectoryConflictsForAgent({
        source,
        entry,
        agentSkillDir,
        relativePath,
        removedSkills,
        currentDirSet,
        oldManagedPathSet,
        conflictSet,
    }: {
        source: string;
        entry: SkillEntry;
        agentSkillDir: string;
        relativePath: string;
        removedSkills: Set<string>;
        currentDirSet: Set<string>;
        oldManagedPathSet: Set<string>;
        conflictSet: SyncPreflightConflictSet;
    }): void {
        const localSkillDir = path.resolve(agentSkillDir, relativePath);
        if (!this.pathMapper.isPathInsideRoot(localSkillDir)) {
            return;
        }

        const localSkillDirRelative = this.pathMapper.toProjectRelativePath(localSkillDir);
        oldManagedPathSet.add(localSkillDirRelative);

        if (!fs.existsSync(localSkillDir) || !fs.statSync(localSkillDir).isDirectory()) {
            return;
        }

        const operation = removedSkills.has(entry.name.toLowerCase()) || !currentDirSet.has(agentSkillDir)
            ? 'delete'
            : 'overwrite';
        const baselineHash = this.normalizeSkillBaselineHash(entry.hash);
        if (!baselineHash) {
            conflictSet.add({
                path: localSkillDirRelative,
                reason: 'missing-baseline-hash',
                operation,
                scope: 'skill',
                source,
                skill: entry.name,
            });
            return;
        }

        const currentHash = Hashing.hashDirectory(localSkillDir);
        if (!currentHash || currentHash.treeSha256 === baselineHash.treeSha256) {
            return;
        }

        const changedFiles = this.diffHashedFiles(baselineHash.files, currentHash.files);
        if (changedFiles.length === 0) {
            conflictSet.add({
                path: localSkillDirRelative,
                reason: 'modified-managed',
                operation,
                scope: 'skill',
                source,
                skill: entry.name,
            });
            return;
        }

        changedFiles.forEach((changedFile) => {
            const absoluteChangedPath = path.resolve(localSkillDir, changedFile);
            if (!this.pathMapper.isPathInsideRoot(absoluteChangedPath)) {
                return;
            }

            conflictSet.add({
                path: this.pathMapper.toProjectRelativePath(absoluteChangedPath),
                reason: 'modified-managed',
                operation,
                scope: 'skill-file',
                source,
                skill: entry.name,
            });
        });
    }

    private normalizeSkillBaselineHash(hash: unknown): DirectoryHash | null {
        if (!hash || typeof hash !== 'object') {
            return null;
        }
        const normalizedHash = hash as DirectoryHash;
        if (!normalizedHash.treeSha256 || !Array.isArray(normalizedHash.files)) {
            return null;
        }

        return normalizedHash;
    }

    private diffHashedFiles(previousFiles: DirectoryFileHash[] | undefined, currentFiles: DirectoryFileHash[] | undefined): string[] {
        const previousByPath = new Map<string, string>(
            (Array.isArray(previousFiles) ? previousFiles : [])
                .map(entry => [entry.path.trim(), entry.sha256.trim()] as const)
                .filter(([filePath]) => Boolean(filePath)),
        );
        const currentByPath = new Map<string, string>(
            (Array.isArray(currentFiles) ? currentFiles : [])
                .map(entry => [entry.path.trim(), entry.sha256.trim()] as const)
                .filter(([filePath]) => Boolean(filePath)),
        );

        const changed = new Set<string>();
        [...previousByPath.keys(), ...currentByPath.keys()].forEach((filePath) => {
            if (previousByPath.get(filePath) !== currentByPath.get(filePath)) {
                changed.add(filePath);
            }
        });

        return Helpers.sortUniq([...changed]);
    }
}
