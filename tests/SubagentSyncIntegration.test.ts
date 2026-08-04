import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { createManager } from '../src';
import GitRunner from '../src/core/git/GitRunner';
import SourceResolver from '../src/core/source/SourceResolver';
import type { ResolvedSource } from '../src/core/types';
import { createSubagentSourceRepository, subagentSourceFiles } from './fixtures/subagentSource';
import { createTempDir } from './helpers';

describe('subagent sync integration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('installs subagents and shared files, then uses the recorded commit in locked mode', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/subagents';
        const resolvedSource: ResolvedSource = {
            ok: true,
            handler: 'github',
            provider: 'github',
            url: sourceDir,
            ref: null,
            subpath: null,
            webUrl: sourceDir,
        };

        try {
            createSubagentSourceRepository(sourceDir);
            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                schemaVersion: 2,
                agents: [],
                subagents: ['opencode'],
                sources: [{ source: sourceName, skills: [], subagents: ['reviewer'] }],
            }), 'utf8');
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), JSON.stringify({
                schemaVersion: 6,
                agents: [],
                subagents: [],
                sources: {},
            }), 'utf8');
            vi.spyOn(SourceResolver.prototype, 'resolve').mockReturnValue(resolvedSource);

            const manager = createManager({ cwd: workspaceDir });
            const first = await manager.runSync({ update: true });
            expect(first).toMatchObject({
                status: 'completed',
                exitCode: 0,
                lockWritten: true,
                subagents: {
                    detected: 1,
                    installed: 1,
                    sharedFiles: 2,
                    removed: 0,
                    sourceReports: [{ source: sourceName, mode: 'explicit', selected: 1, installed: 1, removed: 0, sharedFiles: 2 }],
                },
            });
            expect(fs.readFileSync(path.join(workspaceDir, '.opencode', 'agents', 'reviewer.md'), 'utf8')).toContain('# Reviewer');
            expect(fs.readFileSync(path.join(workspaceDir, subagentSourceFiles.sharedReference), 'utf8')).toContain('Runtime quality');

            const lock = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')) as {
                schemaVersion: number;
                subagents: string[];
                sources: { [key: string]: { subagentEntries: { targetPath: string }[]; sharedEntries: { targetPath: string; owners: string[] }[] } };
            };
            expect(lock.schemaVersion).toBe(6);
            expect(lock.subagents).toEqual(['opencode']);
            expect(lock.sources[sourceName].subagentEntries[0]).toMatchObject({
                name: 'reviewer',
                sourcePath: '.opencode/agent/reviewer.md',
                targetPath: '.opencode/agents/reviewer.md',
                sharedFiles: [
                    '.agents/skills/_shared/references/runtime-quality-procedures.md',
                    '.agents/skills/_shared/scripts/context-manifest.mjs',
                ],
                hash: { executable: false },
            });
            expect(lock.sources[sourceName].sharedEntries).toHaveLength(2);
            expect(lock.sources[sourceName].sharedEntries.every(entry => Array.isArray(entry.owners))).toBe(true);

            fs.writeFileSync(path.join(sourceDir, '.opencode', 'agent', 'reviewer.md'), '# Updated upstream\n', 'utf8');
            const runner = new GitRunner();
            expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
            expect(runner.run(sourceDir, ['commit', '-m', 'update subagent']).ok).toBe(true);

            fs.renameSync(path.join(workspaceDir, '.opencode', 'agents'), path.join(workspaceDir, '.opencode', 'agent'));
            const locked = await manager.runSync();
            expect(locked).toMatchObject({ status: 'completed', lockWritten: false, subagents: { installed: 1 } });
            expect(fs.readFileSync(path.join(workspaceDir, '.opencode', 'agents', 'reviewer.md'), 'utf8')).toContain('# Reviewer');

            const invalidLock = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')) as {
                sources: { [key: string]: { subagentEntries: { hash: { sha256: string } }[] } };
            };
            invalidLock.sources[sourceName].subagentEntries[0].hash.sha256 = 'invalid-lock-hash';
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), `${JSON.stringify(invalidLock)}\n`, 'utf8');
            const rejected = await manager.runSync();
            expect(rejected.status).toBe('error');
            if (rejected.status === 'error') {
                expect(rejected.error).toContain('Locked subagent selection');
            }
            expect(fs.readFileSync(path.join(workspaceDir, '.opencode', 'agents', 'reviewer.md'), 'utf8')).toContain('# Reviewer');
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('installs skills and subagents together through the mixed flow', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/mixed';
        const resolvedSource: ResolvedSource = {
            ok: true,
            handler: 'github',
            provider: 'github',
            url: sourceDir,
            ref: null,
            subpath: null,
            webUrl: sourceDir,
        };

        try {
            createSubagentSourceRepository(sourceDir);
            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                schemaVersion: 2,
                agents: ['codex'],
                subagents: ['opencode'],
                sources: [{ source: sourceName, skills: ['Example'], subagents: ['reviewer'] }],
            }), 'utf8');
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), JSON.stringify({
                schemaVersion: 6,
                agents: [],
                subagents: [],
                sources: {},
            }), 'utf8');
            vi.spyOn(SourceResolver.prototype, 'resolve').mockReturnValue(resolvedSource);

            const result = await createManager({ cwd: workspaceDir }).runSync({ update: true });
            expect(result).toMatchObject({
                status: 'completed',
                exitCode: 0,
                lockWritten: true,
                subagents: {
                    detected: 1,
                    installed: 1,
                    sharedFiles: 2,
                    sourceReports: [{ source: sourceName, mode: 'explicit', selected: 1, installed: 1, removed: 0, sharedFiles: 2 }],
                },
            });
            expect(fs.existsSync(path.join(workspaceDir, '.agents', 'skills', 'example', 'SKILL.md'))).toBe(true);
            expect(fs.existsSync(path.join(workspaceDir, '.opencode', 'agents', 'reviewer.md'))).toBe(true);
            const lock = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')) as {
                sources: { [key: string]: { sharedEntries: { owners: string[] }[] } };
            };
            const owners = lock.sources[sourceName].sharedEntries.flatMap(entry => entry.owners);
            expect(owners).toEqual(expect.arrayContaining(['skill:Example', 'subagent:reviewer']));
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('stops before any write for a missing explicit subagent', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/missing';
        const resolvedSource: ResolvedSource = {
            ok: true,
            handler: 'github',
            provider: 'github',
            url: sourceDir,
            ref: null,
            subpath: null,
            webUrl: sourceDir,
        };

        try {
            createSubagentSourceRepository(sourceDir);
            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                schemaVersion: 2,
                agents: [],
                subagents: ['opencode'],
                sources: [{ source: sourceName, skills: [], subagents: ['missing'] }],
            }), 'utf8');
            const initialLock = JSON.stringify({ schemaVersion: 6, agents: [], subagents: [], sources: {} }, null, 4) + '\n';
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), initialLock, 'utf8');
            vi.spyOn(SourceResolver.prototype, 'resolve').mockReturnValue(resolvedSource);

            const result = await createManager({ cwd: workspaceDir }).runSync({ update: true });
            expect(result).toMatchObject({ status: 'error', exitCode: 1 });
            expect(fs.existsSync(path.join(workspaceDir, '.opencode'))).toBe(false);
            expect(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')).toBe(initialLock);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('detects local conflicts, supports force, and prunes removed subagents', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/conflicts';
        const resolvedSource: ResolvedSource = {
            ok: true,
            handler: 'github',
            provider: 'github',
            url: sourceDir,
            ref: null,
            subpath: null,
            webUrl: sourceDir,
        };

        try {
            createSubagentSourceRepository(sourceDir);
            fs.mkdirSync(workspaceDir, { recursive: true });
            const writeManifest = (selection: string[]): void => {
                fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                    schemaVersion: 2,
                    agents: [],
                    subagents: ['opencode'],
                    sources: [{ source: sourceName, skills: [], subagents: selection }],
                }), 'utf8');
            };
            writeManifest(['reviewer']);
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), JSON.stringify({ schemaVersion: 6, agents: [], subagents: [], sources: {} }), 'utf8');
            vi.spyOn(SourceResolver.prototype, 'resolve').mockReturnValue(resolvedSource);
            const manager = createManager({ cwd: workspaceDir });
            await expect(manager.runSync({ update: true })).resolves.toMatchObject({ status: 'completed' });

            const localPath = path.join(workspaceDir, '.opencode', 'agents', 'reviewer.md');
            fs.writeFileSync(localPath, '# Local change\n', 'utf8');
            fs.writeFileSync(path.join(sourceDir, '.opencode', 'agent', 'reviewer.md'), '# Upstream change\n', 'utf8');
            const runner = new GitRunner();
            expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
            expect(runner.run(sourceDir, ['commit', '-m', 'conflicting upstream']).ok).toBe(true);

            await expect(manager.runSync({ update: true })).resolves.toMatchObject({ status: 'error', exitCode: 1 });
            expect(fs.readFileSync(localPath, 'utf8')).toBe('# Local change\n');
            await expect(manager.runSync({ update: true, force: true })).resolves.toMatchObject({ status: 'completed', exitCode: 0 });
            expect(fs.readFileSync(localPath, 'utf8')).toBe('# Upstream change\n');

            writeManifest([]);
            await expect(manager.runSync({ update: true })).resolves.toMatchObject({
                status: 'completed',
                exitCode: 0,
                subagents: {
                    removed: 3,
                    sourceReports: [{ source: sourceName, mode: 'none', selected: 0, installed: 0, removed: 3, sharedFiles: 0 }],
                },
            });
            expect(fs.existsSync(localPath)).toBe(false);
            expect(fs.existsSync(path.join(workspaceDir, '.agents', 'skills', '_shared', 'references', 'runtime-quality-procedures.md'))).toBe(false);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
