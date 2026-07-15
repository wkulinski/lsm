import fs from 'node:fs';
import path from 'node:path';

import Helpers from '../shared/Helpers';
import { hasSymlinkInPath } from '../filesystem/PathUtils';
import ManifestNormalizer from './ManifestNormalizer';
import LockNormalizer, { LOCK_SCHEMA_VERSION } from './LockNormalizer';
import {
    lockManagedSharedFilesBySource,
    lockManagedSkills,
} from './lockMappers';
import type {
    LockData,
    LockSourceMeta,
    ManifestData,
} from '../types/manifest';

const DEFAULT_JSON_INDENT = 4;

export default class ManifestStore {
    public manifestPath: string;
    public lockPath: string;

    public constructor({ manifestPath, lockPath }: { manifestPath: string; lockPath: string }) {
        this.manifestPath = manifestPath;
        this.lockPath = lockPath;
    }

    public ensureFiles(): string[] {
        const created: string[] = [];
        this.assertSafePath(this.manifestPath);
        this.assertSafePath(this.lockPath);

        if (!fs.existsSync(this.manifestPath)) {
            this.ensureDirForFile(this.manifestPath);
            this.writeJson(this.manifestPath, { agents: [], sources: [] });
            created.push(this.manifestPath);
        }

        if (!fs.existsSync(this.lockPath)) {
            this.ensureDirForFile(this.lockPath);
            this.writeJson(this.lockPath, {
                schemaVersion: LOCK_SCHEMA_VERSION,
                generatedAt: new Date().toISOString(),
                agents: [],
                sources: {},
            });
            created.push(this.lockPath);
        }

        return created;
    }

    public loadManifest(): ManifestData {
        return new ManifestNormalizer({ manifestFileName: path.basename(this.manifestPath) }).normalize(this.loadJson(this.manifestPath));
    }

    public loadLock(): LockData {
        if (!fs.existsSync(this.lockPath)) {
            return new LockNormalizer({ lockFileName: path.basename(this.lockPath) }).emptyLock();
        }

        return new LockNormalizer({ lockFileName: path.basename(this.lockPath) }).normalize(this.loadJson(this.lockPath));
    }

    public lockManagedSkills(lockSources: { [key: string]: LockSourceMeta } | undefined): string[] {
        return lockManagedSkills(lockSources);
    }

    public writeLock({ agents, sources }: { agents: string[]; sources: { [key: string]: LockSourceMeta } }): void {
        this.writeJson(this.lockPath, {
            schemaVersion: LOCK_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            agents: Helpers.sortUniq(agents),
            sources,
        });
    }

    public lockManagedSharedFilesBySource(lockSources: { [key: string]: LockSourceMeta } | undefined): { [key: string]: string[] } {
        return lockManagedSharedFilesBySource(lockSources, { lockFileName: path.basename(this.lockPath) });
    }

    private loadJson(filePath: string): unknown {
        this.assertSafePath(filePath);
        if (!fs.existsSync(filePath)) {
            Helpers.die(`File not found: ${filePath}`);
            return null;
        }
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        catch (e) {
            Helpers.die(`Invalid JSON: ${filePath}\n${String(e)}`);
            return null;
        }
    }

    private writeJson(filePath: string, obj: unknown, indent = DEFAULT_JSON_INDENT): void {
        this.assertSafePath(filePath);
        fs.writeFileSync(filePath, `${JSON.stringify(obj, null, indent)}\n`, 'utf8');
    }

    private ensureDirForFile(filePath: string): void {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private assertSafePath(filePath: string): void {
        const filesystemRoot = path.parse(path.resolve(filePath)).root;
        if (hasSymlinkInPath(filePath, filesystemRoot)) {
            Helpers.die(`Manifest path contains a symbolic link: ${filePath}`);
        }
    }
}
