import { describe, expect, test } from 'vitest';

import SyncLockValidator from '../src/core/sync/SyncLockValidator';
import type {
    DiscoveredSources,
    LockData,
    ManifestData,
} from '../src/core/types';

describe('SyncLockValidator', () => {
    test('rejects an empty lock for a configured manifest', () => {
        const result = new SyncLockValidator().validateManifest({
            manifest: createManifest(),
            lock: createLock({ sources: {} }),
        });

        expect(result).toContain('Lock is empty.');
        expect(result).toContain('lsm sync --update');
    });

    test('rejects manifest agent or source changes', () => {
        const validator = new SyncLockValidator();
        const lock = createLock();

        expect(validator.validateManifest({
            manifest: createManifest({ agents: ['cursor'] }),
            lock,
        })).toContain('Lock agents do not match');
        expect(validator.validateManifest({
            manifest: createManifest({ source: 'owner/other' }),
            lock,
        })).toContain('Lock sources do not match');
    });

    test('rejects a lock without a resolved commit', () => {
        const lock = createLock();
        lock.sources.upstream.resolved.resolvedCommit = null;

        expect(new SyncLockValidator().validateManifest({
            manifest: createManifest(),
            lock,
        })).toContain('has no resolved commit');
    });

    test('accepts a discovered snapshot matching the lock', () => {
        expect(new SyncLockValidator().validateDiscovered({
            lock: createLock(),
            discovered: createDiscovered(),
        })).toBeNull();
    });

    test('rejects a discovered snapshot from a different commit', () => {
        const discovered = createDiscovered();
        discovered.upstream.resolved.resolvedCommit = 'def456';

        expect(new SyncLockValidator().validateDiscovered({
            lock: createLock(),
            discovered,
        })).toContain('unexpected commit');
    });
});

function createManifest({ agents = ['codex'], source = 'upstream' }: { agents?: string[]; source?: string } = {}): ManifestData {
    return {
        agents,
        sources: [{ source, skills: null, publish: { branchPrefix: null, createPr: null } }],
    };
}

function createLock({ sources = { upstream: createLockSource() } }: { sources?: LockData['sources'] } = {}): LockData {
    return {
        schemaVersion: 5,
        agents: ['codex'],
        sources,
    };
}

function createLockSource(): LockData['sources'][string] {
    return {
        mode: 'all',
        listedAt: '2026-07-21T00:00:00.000Z',
        skillEntries: [{
            name: 'Alpha',
            sourcePath: '.agents/skills/alpha',
            sharedFiles: [],
            hash: null,
        }],
        sharedFileHashes: [],
        resolved: {
            requestedRef: null,
            defaultBranch: 'main',
            resolvedRef: 'main',
            resolvedCommit: 'abc123',
            subpath: null,
            resolvedAt: '2026-07-21T00:00:00.000Z',
        },
    };
}

function createDiscovered(): DiscoveredSources {
    return {
        upstream: {
            mode: 'all',
            listedAt: '2026-07-21T00:00:00.000Z',
            skills: ['Alpha'],
            skillEntries: [{
                name: 'Alpha',
                sourcePath: '.agents/skills/alpha',
                sharedFiles: [],
                hash: null,
            }],
            sharedFileHashes: [],
            missingRequested: [],
            resolved: {
                requestedRef: null,
                defaultBranch: 'main',
                resolvedRef: 'main',
                resolvedCommit: 'abc123',
                subpath: null,
                resolvedAt: '2026-07-21T00:00:00.000Z',
            },
        },
    };
}
