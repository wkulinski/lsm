import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import ManifestStore from '../src/core/manifest/ManifestStore';
import { createTempDir, readJson } from './helpers';
import type { LockSourceMeta } from '../src/core/types';

describe('ManifestStore', () => {
    test('creates missing manifest and lock templates', () => {
        const tempDir = createTempDir();

        try {
            const manifestPath = path.join(tempDir, 'nested', 'skills.json');
            const lockPath = path.join(tempDir, 'nested', 'skills.lock.json');
            const store = new ManifestStore({ manifestPath, lockPath });

            expect(store.ensureFiles()).toEqual([manifestPath, lockPath]);
            expect(readJson(manifestPath)).toEqual({
                agents: [],
                sources: [],
            });
            expect(readJson(lockPath)).toMatchObject({
                schemaVersion: 5,
                agents: [],
                sources: {},
            });
            expect(store.ensureFiles()).toEqual([]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('writes sorted lock agents and preserves lock sources', () => {
        const tempDir = createTempDir();

        try {
            const manifestPath = path.join(tempDir, 'skills.json');
            const lockPath = path.join(tempDir, 'skills.lock.json');
            const store = new ManifestStore({ manifestPath, lockPath });
            const sources: { [key: string]: LockSourceMeta } = {
                upstream: {
                    mode: 'all',
                    listedAt: '2026-06-05T00:00:00.000Z',
                    skillEntries: [],
                    sharedFileHashes: [],
                    resolved: {
                        requestedRef: null,
                        defaultBranch: 'main',
                        resolvedRef: 'main',
                        resolvedCommit: 'abc123',
                        subpath: null,
                        resolvedAt: '2026-06-05T00:00:00.000Z',
                    },
                },
            };

            store.writeLock({ agents: [' cursor ', 'codex', 'codex'], sources });

            expect(readJson(lockPath)).toMatchObject({
                schemaVersion: 5,
                agents: [' cursor ', 'codex'],
                sources,
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects manifest paths that contain a symbolic link', () => {
        const tempDir = createTempDir();

        try {
            const outsideManifest = path.join(tempDir, 'outside-skills.json');
            const manifestPath = path.join(tempDir, 'config', 'skills.json');
            const lockPath = path.join(tempDir, 'config', 'skills.lock.json');
            fs.writeFileSync(outsideManifest, '{}\n', 'utf8');
            fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
            fs.symlinkSync(outsideManifest, manifestPath);

            expect(() => new ManifestStore({ manifestPath, lockPath }).ensureFiles()).toThrow('Manifest path contains a symbolic link');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
