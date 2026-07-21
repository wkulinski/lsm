import fs from 'node:fs';
import path from 'node:path';

import Hashing from '../shared/Hashing';
import SyncPathMapper from './SyncPathMapper';
import type SyncPreflightConflictSet from './SyncPreflightConflictSet';
import type {
    BackendLike,
    FileHashEntry,
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
        baselineSharedFileHashes: FileHashEntry[];
        targetSharedFileHashes: FileHashEntry[];
        sourceSkillsRootPrefix: string | undefined;
        allAgentSkillDirs: string[];
        currentDirSet: Set<string>;
        newManagedPathSet: Set<string>;
        oldManagedPathSet: Set<string>;
        conflictSet: SyncPreflightConflictSet;
    }): void {
        const baselineSharedFileHashMap = new Map<string, string>(
            baselineSharedFileHashes
                .map(entry => [entry.path.trim(), entry.sha256.trim()] as const)
                .filter(([filePath, sha256]) => Boolean(filePath && sha256)),
        );
        const targetSharedFileHashMap = new Map<string, string>(
            targetSharedFileHashes
                .map(entry => [entry.path.trim(), entry.sha256.trim()] as const)
                .filter(([filePath, sha256]) => Boolean(filePath && sha256)),
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
                const baselineSha = baselineSharedFileHashMap.get(sourceSharedFilePath);
                const targetSha = targetSharedFileHashMap.get(sourceSharedFilePath);

                const stat = fs.statSync(localSharedFilePath);
                if (!stat.isFile()) {
                    conflictSet.add({
                        path: localSharedFileRelative,
                        reason: baselineSha ? 'modified-managed' : 'missing-baseline-hash',
                        operation,
                        scope: 'shared',
                        source,
                        skill: null,
                    });
                    return;
                }

                const currentSha = Hashing.sha256File(localSharedFilePath);
                if (targetSha === currentSha) {
                    return;
                }
                if (!baselineSha) {
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
                if (currentSha !== baselineSha) {
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
}
