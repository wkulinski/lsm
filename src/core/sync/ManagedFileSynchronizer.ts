import fs from 'node:fs';
import path from 'node:path';

import { hasExecutableBit } from '../filesystem/FilePermissions';
import { hasSymlinkInPath, isPathInside } from '../filesystem/PathUtils';
import Hashing from '../shared/Hashing';
import ManagedFileJournal from './ManagedFileJournal';
import type { ManagedFileHash } from '../types';

export interface ManagedFileDeclaration {
    owner: string;
    sourcePath: string;
    targetPath: string;
    content: Buffer;
    executable: boolean;
}

export interface ManagedFile extends ManagedFileDeclaration {
    hash: ManagedFileHash;
}

export interface ManagedFileBaseline {
    targetPath: string;
    hash: ManagedFileHash;
}

export interface ManagedFilePlan {
    files: ManagedFile[];
    removals: string[];
    managedPathsByOwner: { [owner: string]: string[] };
}

export interface ManagedFilePlanSuccess {
    ok: true;
    plan: ManagedFilePlan;
}

export interface ManagedFilePlanFailure {
    ok: false;
    error: string;
    details?: unknown;
}

export type ManagedFilePlanResult = ManagedFilePlanSuccess | ManagedFilePlanFailure;

interface NormalizedDeclaration extends ManagedFile {
    normalizedTargetPath: string;
}

export default class ManagedFileSynchronizer {
    private readonly root: string;
    private readonly journal: ManagedFileJournal;

    public constructor({ root, journal }: { root: string; journal?: ManagedFileJournal }) {
        this.root = path.resolve(root);
        this.journal = journal ?? new ManagedFileJournal({ root: this.root });
    }

    public plan({
        files,
        removals = [],
        baselines = [],
        rejectUnmanaged = false,
    }: {
        files: ManagedFileDeclaration[];
        removals?: string[];
        baselines?: ManagedFileBaseline[];
        rejectUnmanaged?: boolean;
    }): ManagedFilePlanResult {
        try {
            return this.planValidated({ files, removals, baselines, rejectUnmanaged });
        }
        catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private planValidated({
        files,
        removals = [],
        baselines = [],
        rejectUnmanaged = false,
    }: {
        files: ManagedFileDeclaration[];
        removals?: string[];
        baselines?: ManagedFileBaseline[];
        rejectUnmanaged?: boolean;
    }): ManagedFilePlanResult {
        const normalized = files
            .map(file => this.normalizeDeclaration(file))
            .sort((left, right) => left.normalizedTargetPath.localeCompare(right.normalizedTargetPath));
        const byTarget = new Map<string, NormalizedDeclaration>();
        const ownershipConflicts: { filePath: string; a: string; b: string }[] = [];

        for (const file of normalized) {
            const previous = byTarget.get(file.normalizedTargetPath);
            if (previous && (previous.owner !== file.owner || !this.sameHash(previous.hash, file.hash))) {
                ownershipConflicts.push({ filePath: file.normalizedTargetPath, a: previous.owner, b: file.owner });
                continue;
            }
            byTarget.set(file.normalizedTargetPath, previous ?? file);
        }

        if (ownershipConflicts.length > 0) {
            return {
                ok: false,
                error: 'Managed file ownership conflicts detected.',
                details: ownershipConflicts,
            };
        }

        const baselineByTarget = new Map(
            baselines.map(baseline => [this.normalizeTargetPath(baseline.targetPath), baseline.hash] as const),
        );
        const unmanagedConflicts: string[] = [];
        for (const file of byTarget.values()) {
            const targetPath = this.resolveTarget(file.normalizedTargetPath);
            this.validateTarget(targetPath);
            if (!fs.existsSync(targetPath)) {
                continue;
            }

            const currentHash = this.hashFile(targetPath);
            const baseline = baselineByTarget.get(file.normalizedTargetPath);
            if (baseline && !this.sameHash(currentHash, baseline) && !this.sameHash(currentHash, file.hash)) {
                unmanagedConflicts.push(file.normalizedTargetPath);
            }
            else if (!baseline && rejectUnmanaged && !this.sameHash(currentHash, file.hash)) {
                unmanagedConflicts.push(file.normalizedTargetPath);
            }
        }

        const normalizedRemovals = [...new Set(removals.map(entry => this.normalizeTargetPath(entry)))]
            .filter(target => !byTarget.has(target))
            .sort((left, right) => left.localeCompare(right));
        normalizedRemovals.forEach((relativePath) => {
            const targetPath = this.resolveTarget(relativePath);
            this.validateTarget(targetPath, true);
            if (!fs.existsSync(targetPath)) {
                return;
            }
            const baseline = baselineByTarget.get(relativePath);
            if (baseline && !this.sameHash(this.hashFile(targetPath), baseline)) {
                unmanagedConflicts.push(relativePath);
            }
        });

        if (unmanagedConflicts.length > 0) {
            return {
                ok: false,
                error: 'Managed file local conflicts detected.',
                details: unmanagedConflicts,
            };
        }

        const managedPathsByOwner: { [owner: string]: string[] } = {};
        byTarget.forEach((file) => {
            managedPathsByOwner[file.owner] ??= [];
            managedPathsByOwner[file.owner].push(file.normalizedTargetPath);
        });
        Object.values(managedPathsByOwner).forEach(paths => paths.sort((left, right) => left.localeCompare(right)));

        return {
            ok: true,
            plan: {
                files: [...byTarget.values()].map(({ normalizedTargetPath, ...file }) => ({
                    ...file,
                    targetPath: normalizedTargetPath,
                })),
                removals: normalizedRemovals,
                managedPathsByOwner,
            },
        };
    }

    public apply(plan: ManagedFilePlan): void {
        this.journal.apply({ writes: plan.files, removals: plan.removals });
    }

    public synchronize(input: Parameters<ManagedFileSynchronizer['plan']>[0]): ManagedFilePlan {
        const planned = this.plan(input);
        if (!planned.ok) {
            throw new Error(planned.error);
        }
        this.apply(planned.plan);
        return planned.plan;
    }

    private normalizeDeclaration(file: ManagedFileDeclaration): NormalizedDeclaration {
        const normalizedTargetPath = this.normalizeTargetPath(file.targetPath);
        const hash = {
            sha256: Hashing.sha256Buffer(file.content),
            executable: file.executable,
        };
        return {
            ...file,
            owner: file.owner.trim(),
            sourcePath: file.sourcePath.trim().replace(/\\/g, '/'),
            targetPath: normalizedTargetPath,
            normalizedTargetPath,
            hash,
        };
    }

    private normalizeTargetPath(value: string): string {
        const normalized = value.trim().replace(/\\/g, '/');
        if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
            throw new Error(`Managed file target must be a relative path: ${value}`);
        }
        const segments = normalized.split('/').filter(segment => segment && segment !== '.');
        if (segments.some(segment => segment === '..')) {
            throw new Error(`Managed file target cannot contain "..": ${value}`);
        }
        return segments.join('/');
    }

    private resolveTarget(relativePath: string): string {
        const targetPath = path.resolve(this.root, ...relativePath.split('/'));
        if (!isPathInside(targetPath, this.root) || targetPath === this.root) {
            throw new Error(`Managed file target escapes project root: ${relativePath}`);
        }
        return targetPath;
    }

    private validateTarget(targetPath: string, allowMissing = false): void {
        if (hasSymlinkInPath(targetPath, this.root)) {
            throw new Error(`Managed file target contains a symbolic link: ${targetPath}`);
        }
        if (!fs.existsSync(targetPath)) {
            if (allowMissing) {
                return;
            }
            return;
        }
        if (!fs.statSync(targetPath).isFile()) {
            throw new Error(`Managed file target is not a file: ${targetPath}`);
        }
    }

    private hashFile(filePath: string): ManagedFileHash {
        const stat = fs.statSync(filePath);
        return {
            sha256: Hashing.sha256File(filePath),
            executable: hasExecutableBit(stat.mode),
        };
    }

    private sameHash(left: ManagedFileHash, right: ManagedFileHash): boolean {
        return left.sha256 === right.sha256 && left.executable === right.executable;
    }
}
