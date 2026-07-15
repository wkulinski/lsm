import fs from 'node:fs';
import path from 'node:path';

import Hashing from '../shared/Hashing';
import SyncPathMapper from './SyncPathMapper';
import type SyncPreflightConflictSet from './SyncPreflightConflictSet';
import type { BackendLike } from '../types';

export default class SyncPreflightUnmanagedConflicts {
    private readonly backend: BackendLike;
    private readonly pathMapper: SyncPathMapper;

    public constructor({ backend, pathMapper }: { backend: BackendLike; pathMapper?: SyncPathMapper }) {
        this.backend = backend;
        this.pathMapper = pathMapper ?? new SyncPathMapper({ backend });
    }

    public collectUnmanagedExistingPathConflicts({
        newManagedPathSet,
        oldManagedPathSet,
        conflictSet,
    }: {
        newManagedPathSet: Set<string>;
        oldManagedPathSet: Set<string>;
        conflictSet: SyncPreflightConflictSet;
    }): void {
        newManagedPathSet.forEach((localPath) => {
            if (oldManagedPathSet.has(localPath)) {
                return;
            }

            const absolutePath = path.resolve(this.backend.root, localPath);
            if (!this.pathMapper.isPathInsideRoot(absolutePath)) {
                return;
            }
            if (!fs.existsSync(absolutePath)) {
                return;
            }

            const stat = fs.statSync(absolutePath);
            if (stat.isDirectory()) {
                const currentHash = Hashing.hashDirectory(absolutePath);
                if (!currentHash || currentHash.files.length === 0) {
                    return;
                }
            }
            else if (!stat.isFile()) {
                return;
            }

            conflictSet.add({
                path: localPath,
                reason: 'unmanaged-existing-path',
                operation: 'overwrite',
                scope: stat.isDirectory() ? 'skill' : 'shared',
                source: null,
                skill: null,
            });
        });
    }
}
