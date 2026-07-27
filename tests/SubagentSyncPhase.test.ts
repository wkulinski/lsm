import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import Hashing from '../src/core/shared/Hashing';
import SubagentSyncPhase from '../src/core/sync/SubagentSyncPhase';
import type { DiscoveredSources, LockData, SubagentDefinition } from '../src/core/types';
import { createTempDir } from './helpers';

const AGENT_PATH = '.opencode/agents/reviewer.md';
const SHARED_PATH = '.agents/skills/_shared/references/runtime.md';

describe('SubagentSyncPhase', () => {
    test('rolls back agent and shared-file changes after a later rename fails', () => {
        const root = createTempDir();
        const agentPath = path.join(root, AGENT_PATH);
        const sharedPath = path.join(root, SHARED_PATH);
        fs.mkdirSync(path.dirname(agentPath), { recursive: true });
        fs.mkdirSync(path.dirname(sharedPath), { recursive: true });
        fs.writeFileSync(agentPath, '# Old agent\n');
        fs.writeFileSync(sharedPath, '# Old shared\n');
        const originalRename = fs.renameSync;
        let finalRenames = 0;
        const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            const destination = String(to);
            if (!destination.includes('.lsm-managed-journal-')) {
                finalRenames += 1;
                if (finalRenames === 2) {
                    throw new Error('simulated subagent rename failure');
                }
            }
            originalRename(from, to);
        });

        try {
            const result = new SubagentSyncPhase({ root }).synchronize({
                lock: createLock({
                    subagentEntries: [{
                        name: 'reviewer',
                        sourcePath: '.opencode/agent/reviewer.md',
                        targetPath: AGENT_PATH,
                        sharedFiles: [SHARED_PATH],
                        hash: managedHash('# Old agent\n', false),
                    }],
                    sharedEntries: [{
                        sourcePath: SHARED_PATH,
                        targetPath: SHARED_PATH,
                        hash: managedHash('# Old shared\n', false),
                        owners: ['subagent:reviewer'],
                    }],
                }),
                discovered: createDiscovered({
                    subagents: [createSubagent('# New agent\n')],
                    sharedFiles: [{ path: SHARED_PATH, content: Buffer.from('# New shared\n'), executable: false }],
                }),
            });

            expect(result).toMatchObject({
                subagentFailed: true,
                errors: [{ message: 'Failed while applying managed subagents.' }],
            });
            expect(fs.readFileSync(agentPath, 'utf8')).toBe('# Old agent\n');
            expect(fs.readFileSync(sharedPath, 'utf8')).toBe('# Old shared\n');
            expect(fs.readdirSync(root).some(entry => entry.startsWith('.lsm-managed-journal-'))).toBe(false);
        }
        finally {
            renameSpy.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rejects shared-file ownership conflicts across sources even for identical content', () => {
        const root = createTempDir();

        try {
            const result = new SubagentSyncPhase({ root }).plan({
                lock: createLock(),
                discovered: {
                    ...createDiscovered({ source: 'source-a', subagents: [], sharedFiles: [{ path: SHARED_PATH, content: Buffer.from('# Same\n'), executable: false }] }),
                    ...createDiscovered({ source: 'source-b', subagents: [], sharedFiles: [{ path: SHARED_PATH, content: Buffer.from('# Same\n'), executable: false }] }),
                },
            });

            expect(result).toMatchObject({
                ok: false,
                error: 'Managed file ownership conflicts detected.',
            });
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('detects an executable-only local change before applying an agent', () => {
        const root = createTempDir();
        const agentPath = path.join(root, AGENT_PATH);
        fs.mkdirSync(path.dirname(agentPath), { recursive: true });
        fs.writeFileSync(agentPath, '# Same agent\n');
        fs.chmodSync(agentPath, 0o755);

        try {
            const result = new SubagentSyncPhase({ root }).plan({
                lock: createLock({
                    subagentEntries: [{
                        name: 'reviewer',
                        sourcePath: '.opencode/agent/reviewer.md',
                        targetPath: AGENT_PATH,
                        sharedFiles: [],
                        hash: managedHash('# Same agent\n', false),
                    }],
                }),
                discovered: createDiscovered({ subagents: [createSubagent('# Same agent\n')] }),
            });

            expect(result).toMatchObject({
                ok: false,
                error: 'Managed file local conflicts detected.',
                details: [AGENT_PATH],
            });
            expect(fs.statSync(agentPath).mode & 0o111).toBe(0o111);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

function createSubagent(content: string, executable = false): SubagentDefinition {
    const buffer = Buffer.from(content);
    return {
        name: 'reviewer',
        description: null,
        sourcePath: '.opencode/agent/reviewer.md',
        targetPath: AGENT_PATH,
        sharedFiles: [],
        content: buffer,
        hash: managedHash(content, executable),
    };
}

function createDiscovered({
    source = 'source-a',
    subagents = [],
    sharedFiles = [],
}: {
    source?: string;
    subagents?: SubagentDefinition[];
    sharedFiles?: { path: string; content: Buffer; executable: boolean }[];
} = {}): DiscoveredSources {
    return {
        [source]: {
            mode: 'all',
            listedAt: '2026-07-27T00:00:00.000Z',
            skills: [],
            skillEntries: [],
            sharedFileHashes: [],
            subagents,
            subagentSharedFiles: sharedFiles,
            missingRequested: [],
            resolved: {
                requestedRef: null,
                defaultBranch: 'main',
                resolvedRef: 'main',
                resolvedCommit: 'abc123',
                subpath: null,
                resolvedAt: '2026-07-27T00:00:00.000Z',
            },
        },
    };
}

function createLock({
    subagentEntries = [],
    sharedEntries = [],
}: {
    subagentEntries?: LockData['sources'][string]['subagentEntries'];
    sharedEntries?: LockData['sources'][string]['sharedEntries'];
} = {}): LockData {
    return {
        schemaVersion: 6,
        agents: [],
        subagents: ['opencode'],
        sources: {
            source: {
                mode: 'all',
                listedAt: '2026-07-27T00:00:00.000Z',
                skillEntries: [],
                subagentEntries,
                sharedEntries,
                resolved: {
                    requestedRef: null,
                    defaultBranch: 'main',
                    resolvedRef: 'main',
                    resolvedCommit: 'abc123',
                    subpath: null,
                    resolvedAt: '2026-07-27T00:00:00.000Z',
                },
            },
        },
    };
}

function managedHash(content: string, executable: boolean): { sha256: string; executable: boolean } {
    return { sha256: Hashing.sha256Buffer(Buffer.from(content)), executable };
}
