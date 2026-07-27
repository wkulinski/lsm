import fs from 'node:fs';
import path from 'node:path';

import Hashing from '../shared/Hashing';
import SyncPathMapper from './SyncPathMapper';
import type SyncPreflightConflictSet from './SyncPreflightConflictSet';
import type {
    BackendLike,
    ManagedFileHashEntry,
    SkillEntry,
} from '../types';

export default class SyncPreflightSharedConflicts {
    private readonly pathMapper: SyncPathMapper;

    public constructor({ backend, pathMapper }: { backend: BackendLike; pathMapper?: SyncPathMapper }) {
        this.pathMapper = pathMapper ?? new SyncPathMapper({ backend });
    }

    public collectSharedFileConflictsForSource({
        source,
        skillEntries,
        targetSkillEntries,
        baselineSharedFileHashes,
        targetSharedFileHashes,
        sourceSkillsRootPrefix,
        allAgentSkillDirs,
        currentDirSet,
        newManagedPathSet,
        oldManagedPathSet,
        conflictSet,
    }: {
        source: string;
        skillEntries: SkillEntry[];
        targetSkillEntries: SkillEntry[];
        baselineSharedFileHashes: ManagedFileHashEntry[];
        targetSharedFileHashes: ManagedFileHashEntry[];
        sourceSkillsRootPrefix: string | undefined;
        allAgentSkillDirs: string[];
        currentDirSet: Set<string>;
        newManagedPathSet: Set<string>;
        oldManagedPathSet: Set<string>;
        conflictSet: SyncPreflightConflictSet;
    }): void {
        const baselineSharedFileHashMap = new Map<string, { sha256: string; executable: boolean }>(
            baselineSharedFileHashes
                .map(entry => [entry.path.trim(), entry.hash] as const)
                .filter(([filePath, hash]) => Boolean(filePath && hash.sha256)),
        );
        const targetSharedFileHashMap = new Map<string, { sha256: string; executable: boolean }>(
            targetSharedFileHashes
                .map(entry => [entry.path.trim(), entry.hash] as const)
                .filter(([filePath, hash]) => Boolean(filePath && hash.sha256)),
        );
        const oldSharedFiles = new Set([
            ...baselineSharedFileHashMap.keys(),
            ...this.pathMapper.collectSharedFilesFromSkillEntries(skillEntries),
        ]);
        const sourceSharedFiles = new Set([
            ...oldSharedFiles,
            ...targetSharedFileHashMap.keys(),
            ...this.pathMapper.collectSharedFilesFromSkillEntries(targetSkillEntries),
        ]);

        sourceSharedFiles.forEach((sourceSharedFilePath) => {
            const relativePath = this.pathMapper.relativeToSkillsRoot(sourceSharedFilePath, sourceSkillsRootPrefix);
            if (!relativePath) {
                return;
            }

            allAgentSkillDirs.forEach((agentSkillDir) => {
                const localSharedFilePath = path.resolve(agentSkillDir, relativePath);
                if (!this.pathMapper.isPathInsideRoot(localSharedFilePath)) {
                    return;
                }

                const localSharedFileRelative = this.pathMapper.toProjectRelativePath(localSharedFilePath);
                if (oldSharedFiles.has(sourceSharedFilePath)) {
                    oldManagedPathSet.add(localSharedFileRelative);
                }

                if (!fs.existsSync(localSharedFilePath)) {
                    return;
                }

                const operation = currentDirSet.has(agentSkillDir) && newManagedPathSet.has(localSharedFileRelative)
                    ? 'overwrite'
                    : 'delete';
                const baselineHash = baselineSharedFileHashMap.get(sourceSharedFilePath);
                const targetHash = targetSharedFileHashMap.get(sourceSharedFilePath);

                const stat = fs.statSync(localSharedFilePath);
                if (!stat.isFile()) {
                    conflictSet.add({
                        path: localSharedFileRelative,
                        reason: baselineHash ? 'modified-managed' : 'missing-baseline-hash',
                        operation,
                        scope: 'shared',
                        source,
                        skill: null,
                    });
                    return;
                }

                const currentHash = {
                    sha256: Hashing.sha256File(localSharedFilePath),
                    executable: (stat.mode & 0o111) !== 0,
                };
                if (targetHash && this.sameHash(targetHash, currentHash)) {
                    return;
                }
                if (!baselineHash) {
                    conflictSet.add({
                        path: localSharedFileRelative,
                        reason: 'missing-baseline-hash',
                        operation,
                        scope: 'shared',
                        source,
                        skill: null,
                    });
                    return;
                }
                if (!this.sameHash(currentHash, baselineHash)) {
                    conflictSet.add({
                        path: localSharedFileRelative,
                        reason: 'modified-managed',
                        operation,
                        scope: 'shared',
                        source,
                        skill: null,
                    });
                }
            });
        });
    }

    private sameHash(left: { sha256: string; executable: boolean }, right: { sha256: string; executable: boolean }): boolean {
        return left.sha256 === right.sha256 && left.executable === right.executable;
    }
}
