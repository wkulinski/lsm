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
            const pluginSourcePath = path.join(sourceDir, '.opencode/plugins/mixed.js');
            writePlugin(pluginSourcePath, 'module.exports = true;\n');
            const runner = new GitRunner();
            expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
            expect(runner.run(sourceDir, ['commit', '-m', 'add mixed plugin']).ok).toBe(true);
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
                    installed: 2,
                    sharedFiles: 2,
                    plugins: { detected: 1, installed: 1, removed: 0 },
                    sourceReports: [{ source: sourceName, mode: 'explicit', selected: 1, installed: 2, removed: 0, sharedFiles: 2 }],
                },
            });
            expect(fs.existsSync(path.join(workspaceDir, '.agents', 'skills', 'example', 'SKILL.md'))).toBe(true);
            expect(fs.existsSync(path.join(workspaceDir, '.opencode', 'agents', 'reviewer.md'))).toBe(true);
            expect(fs.existsSync(path.join(workspaceDir, '.opencode/plugins/mixed.js'))).toBe(true);
            const lock = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')) as {
                sources: { [key: string]: { pluginEntries: { sourcePath: string; targetPath: string; hash: { sha256: string; executable: boolean } }[]; sharedEntries: { owners: string[] }[] } };
            };
            const owners = lock.sources[sourceName].sharedEntries.flatMap(entry => entry.owners);
            expect(owners).toEqual(expect.arrayContaining(['skill:Example', 'subagent:reviewer']));
            expect(lock.sources[sourceName].pluginEntries).toHaveLength(1);
            expect(lock.sources[sourceName].pluginEntries[0]).toMatchObject({
                targetPath: '.opencode/plugins/mixed.js',
                sourcePath: '.opencode/plugins/mixed.js',
                hash: { executable: false },
            });
            expect(lock.sources[sourceName].pluginEntries[0]?.hash.sha256).toEqual(expect.any(String));
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('syncs plugins through update and locked mode, then prunes only managed plugin files', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/plugins';
        const pluginSourcePath = path.join(sourceDir, '.opencode/plugins/plugin.js');
        const pluginTargetPath = path.join(workspaceDir, '.opencode/plugins/plugin.js');
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
            writePlugin(pluginSourcePath, 'module.exports = 1;\n');
            const runner = new GitRunner();
            expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
            expect(runner.run(sourceDir, ['commit', '-m', 'add plugin']).ok).toBe(true);

            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                schemaVersion: 2,
                agents: [],
                subagents: ['opencode'],
                sources: [{ source: sourceName, skills: [], subagents: [] }],
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
                    detected: 0,
                    installed: 1,
                    removed: 0,
                    sharedFiles: 0,
                    plugins: { detected: 1, installed: 1, removed: 0 },
                    sourceReports: [{ source: sourceName, mode: 'none', selected: 0, installed: 1, removed: 0, sharedFiles: 0 }],
                },
            });
            expect(fs.readFileSync(pluginTargetPath, 'utf8')).toBe('module.exports = 1;\n');

            const initialLock = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')) as {
                sources: { [key: string]: { pluginEntries: { sourcePath: string; targetPath: string; hash: { sha256: string; executable: boolean } }[] } };
            };
            expect(initialLock.sources[sourceName].pluginEntries).toHaveLength(1);
            expect(initialLock.sources[sourceName].pluginEntries[0]).toMatchObject({
                sourcePath: '.opencode/plugins/plugin.js',
                targetPath: '.opencode/plugins/plugin.js',
                hash: { executable: false },
            });

            writePlugin(pluginSourcePath, 'module.exports = 2;\n');
            expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
            expect(runner.run(sourceDir, ['commit', '-m', 'update plugin']).ok).toBe(true);

            const locked = await manager.runSync();
            expect(locked).toMatchObject({
                status: 'completed',
                lockWritten: false,
                subagents: { installed: 1, plugins: { detected: 1, installed: 1, removed: 0 } },
            });
            expect(fs.readFileSync(pluginTargetPath, 'utf8')).toBe('module.exports = 1;\n');

            const unmanagedPath = path.join(workspaceDir, '.opencode/plugins/manual.js');
            writePlugin(unmanagedPath, 'module.exports = "manual";\n');
            fs.rmSync(pluginSourcePath);
            expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
            expect(runner.run(sourceDir, ['commit', '-m', 'remove plugin']).ok).toBe(true);

            const pruned = await manager.runSync({ update: true });
            expect(pruned).toMatchObject({
                status: 'completed',
                exitCode: 0,
                lockWritten: true,
                subagents: {
                    detected: 0,
                    installed: 0,
                    removed: 1,
                    sharedFiles: 0,
                    plugins: { detected: 0, installed: 0, removed: 1 },
                    sourceReports: [{ source: sourceName, mode: 'none', selected: 0, installed: 0, removed: 1, sharedFiles: 0 }],
                },
            });
            expect(fs.existsSync(pluginTargetPath)).toBe(false);
            expect(fs.existsSync(unmanagedPath)).toBe(true);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('preserves nested plugin paths and executable bits through update and lock', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/executable-plugin';
        const pluginSourcePath = path.join(sourceDir, '.opencode/plugins/nested/loader.bin');
        const pluginTargetPath = path.join(workspaceDir, '.opencode/plugins/nested/loader.bin');
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
            writePlugin(pluginSourcePath, '#!/bin/sh\nexit 0\n', true);
            const runner = new GitRunner();
            expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
            expect(runner.run(sourceDir, ['commit', '-m', 'add executable nested plugin']).ok).toBe(true);

            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                schemaVersion: 2,
                agents: [],
                subagents: ['opencode'],
                sources: [{ source: sourceName, skills: [], subagents: [] }],
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
                subagents: {
                    detected: 0,
                    installed: 1,
                    plugins: { detected: 1, installed: 1, removed: 0 },
                },
            });
            expect(fs.readFileSync(pluginTargetPath, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
            expect(fs.statSync(pluginTargetPath).mode & 0o111).toBe(0o111);

            const lock = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')) as {
                sources: { [key: string]: { pluginEntries: { sourcePath: string; targetPath: string; hash: { sha256: string; executable: boolean } }[] } };
            };
            expect(lock.sources[sourceName].pluginEntries).toHaveLength(1);
            expect(lock.sources[sourceName].pluginEntries[0]).toMatchObject({
                sourcePath: '.opencode/plugins/nested/loader.bin',
                targetPath: '.opencode/plugins/nested/loader.bin',
                hash: { executable: true },
            });
            expect(lock.sources[sourceName].pluginEntries[0]?.hash.sha256).toMatch(/^[a-f0-9]{64}$/);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rejects the same plugin target from two sources before writing or changing the lock', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const firstSource = 'local/plugins-a';
        const secondSource = 'local/plugins-b';
        const pluginTargetPath = path.join(workspaceDir, '.opencode/plugins/plugin.js');
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
            writePlugin(path.join(sourceDir, '.opencode/plugins/plugin.js'), 'module.exports = true;\n');
            const runner = new GitRunner();
            expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
            expect(runner.run(sourceDir, ['commit', '-m', 'add shared plugin target']).ok).toBe(true);

            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                schemaVersion: 2,
                agents: [],
                subagents: ['opencode'],
                sources: [
                    { source: firstSource, skills: [], subagents: [] },
                    { source: secondSource, skills: [], subagents: [] },
                ],
            }), 'utf8');
            const initialLock = `${JSON.stringify({ schemaVersion: 6, agents: [], subagents: [], sources: {} }, null, 4)}\n`;
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), initialLock, 'utf8');
            vi.spyOn(SourceResolver.prototype, 'resolve').mockReturnValue(resolvedSource);

            const result = await createManager({ cwd: workspaceDir }).runSync({ update: true, force: true });
            expect(result).toMatchObject({
                status: 'subagent-failed',
                exitCode: 1,
                subagents: {
                    subagentFailed: true,
                    errors: [{ message: 'Managed file ownership conflicts detected.' }],
                },
            });
            expect(fs.existsSync(pluginTargetPath)).toBe(false);
            expect(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')).toBe(initialLock);
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

function writePlugin(filePath: string, content: string, executable = false): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    if (executable) {
        fs.chmodSync(filePath, 0o755);
    }
}
