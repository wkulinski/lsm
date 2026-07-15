import fs from 'node:fs';
import path from 'node:path';

import Helpers from '../shared/Helpers';
import { hasSymlinkInPath, isPathInside } from '../filesystem/PathUtils';
import SyncPathMapper from './SyncPathMapper';
import type { BackendLike } from '../types';

export default class SyncSharedFilePruner {
    public backend: BackendLike;
    public pathMapper: SyncPathMapper;

    public constructor({ backend }: { backend: BackendLike }) {
        this.backend = backend;
        this.pathMapper = new SyncPathMapper({ backend });
    }

    public pruneStaleManagedFiles(managedOld: { [key: string]: string[] }, managedNew: { [key: string]: string[] }): number {
        const allNewPaths = new Set(Object.values(managedNew).flatMap(files => files));
        const sources = Helpers.sortUniq([...Object.keys(managedOld), ...Object.keys(managedNew)]);
        let removedFiles = 0;

        sources.forEach((source) => {
            const oldFiles = new Set(managedOld[source] ?? []);
            const newFiles = new Set(managedNew[source] ?? []);

            oldFiles.forEach((filePath) => {
                if (newFiles.has(filePath)) {
                    return;
                }
                if (allNewPaths.has(filePath)) {
                    return;
                }

                const absolutePath = path.resolve(this.backend.root, filePath);
                if (!isPathInside(absolutePath, this.backend.root)) {
                    return;
                }
                if (hasSymlinkInPath(absolutePath, this.backend.root)) {
                    return;
                }
                if (!fs.existsSync(absolutePath)) {
                    return;
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) {
                    return;
                }

                fs.rmSync(absolutePath, { force: true });
                this.cleanupEmptyParents(path.dirname(absolutePath));
                removedFiles += 1;
            });
        });

        return removedFiles;
    }

    private cleanupEmptyParents(startDirectoryPath: string): void {
        let currentDirectoryPath = path.resolve(startDirectoryPath);
        const projectRoot = path.resolve(this.backend.root);

        while (isPathInside(currentDirectoryPath, projectRoot) && currentDirectoryPath !== projectRoot) {
            if (!fs.existsSync(currentDirectoryPath)) {
                currentDirectoryPath = path.dirname(currentDirectoryPath);
                continue;
            }

            const entries = fs.readdirSync(currentDirectoryPath);
            if (entries.length > 0) {
                break;
            }

            fs.rmdirSync(currentDirectoryPath);
            currentDirectoryPath = path.dirname(currentDirectoryPath);
        }
    }
}
