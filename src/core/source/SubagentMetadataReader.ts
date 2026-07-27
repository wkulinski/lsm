import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

import { hasSymlinkInPath, isPathInside, normalizePosixPath } from '../filesystem/PathUtils';

const SHARED_ROOT = '.agents/skills/_shared/';
const ALLOWED_KEYS = new Set(['schema_version', 'shared_files']);

interface UnknownRecord { [key: string]: unknown }

export default class SubagentMetadataReader {
    public read(agentPath: string, sourceRoot: string): string[] {
        const sidecarPath = `${agentPath}.lsm.yaml`;
        let sidecarStat: fs.Stats;
        try {
            sidecarStat = fs.lstatSync(sidecarPath);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return [];
            }
            throw error;
        }
        if (sidecarStat.isSymbolicLink() || hasSymlinkInPath(sidecarPath, sourceRoot)) {
            throw new Error(`Subagent sidecar contains a symbolic link: ${path.basename(sidecarPath)}`);
        }
        if (!sidecarStat.isFile()) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: sidecar is not a file`);
        }

        const document = parseDocument(fs.readFileSync(sidecarPath, 'utf8'));
        if (document.errors.length > 0) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: ${document.errors[0].message}`);
        }
        const value = document.toJS({ maxAliasCount: 0 }) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: sidecar must be an object`);
        }

        const data = value as UnknownRecord;
        const unknownKeys = Object.keys(data).filter(key => !ALLOWED_KEYS.has(key));
        if (unknownKeys.length > 0) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: unknown field "${unknownKeys[0]}"`);
        }
        if (data.schema_version !== 1) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: schema_version must be 1`);
        }
        if (!Array.isArray(data.shared_files)) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: "shared_files" must be an array`);
        }

        const normalized = data.shared_files.map((entry, index) => this.normalizeSharedFile(entry, index, sidecarPath, sourceRoot));
        return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
    }

    private normalizeSharedFile(value: unknown, index: number, sidecarPath: string, sourceRoot: string): string {
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: "shared_files[${String(index)}]" must be a non-empty POSIX path`);
        }

        if (value.includes('\\')) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: "shared_files[${String(index)}]" must use POSIX separators`);
        }
        const normalized = normalizePosixPath(value.trim());
        if (normalized.startsWith('/') || normalized.split('/').some(part => part === '..')) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: "shared_files[${String(index)}]" must stay inside ${SHARED_ROOT}`);
        }
        if (!normalized.startsWith(SHARED_ROOT)) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: shared file must be inside ${SHARED_ROOT}`);
        }

        const absolutePath = path.resolve(sourceRoot, normalized);
        if (!isPathInside(absolutePath, sourceRoot) || hasSymlinkInPath(absolutePath, sourceRoot)) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: shared file is outside the source root or contains a symbolic link`);
        }
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: shared file does not exist: ${normalized}`);
        }
        if (!fs.statSync(absolutePath).isFile()) {
            throw new Error(`Invalid subagent sidecar ${sidecarPath}: shared file is not a file: ${normalized}`);
        }

        return normalized;
    }
}
