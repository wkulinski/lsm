import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { createManager } from '../src';
import GitRunner from '../src/core/git/GitRunner';
import SourceResolver from '../src/core/source/SourceResolver';
import type { ResolvedSource } from '../src/core/types';
import { createTempDir } from './helpers';

describe('manager integration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('syncs skills and shared files from a local Git source', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/source';
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
            createSourceRepository(sourceDir);
            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                agents: ['codex'],
                sources: [{ source: sourceName }],
            }), 'utf8');
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), JSON.stringify({
                schemaVersion: 5,
                generatedAt: new Date().toISOString(),
                agents: [],
                sources: {},
            }), 'utf8');
            vi.spyOn(SourceResolver.prototype, 'resolve').mockReturnValue(resolvedSource);

            const result = await createManager({ cwd: workspaceDir }).runSync({ update: true });

            expect(result).toMatchObject({
                status: 'completed',
                exitCode: 0,
                lockWritten: true,
            });
            expect(fs.readFileSync(path.join(workspaceDir, '.agents', 'skills', 'example', 'SKILL.md'), 'utf8')).toContain('# Example');
            expect(fs.readFileSync(path.join(workspaceDir, '.agents', 'skills', 'shared', 'config.json'), 'utf8')).toBe('{"enabled":true}\n');

            const lock = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')) as {
                agents: string[];
                sources: { [key: string]: { skillEntries: { name: string; sourcePath: string; sharedFiles: string[] }[] } };
            };
            expect(lock.agents).toEqual(['codex']);
            expect(lock.sources[sourceName].skillEntries).toMatchObject([{
                name: 'Example',
                sourcePath: '.agents/skills/example',
                sharedFiles: ['.agents/skills/shared/config.json'],
            }]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('keeps locked sync on the recorded commit until update is requested', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/source';
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
            createSourceRepository(sourceDir);
            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                agents: ['codex'],
                sources: [{ source: sourceName }],
            }), 'utf8');
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), JSON.stringify({
                schemaVersion: 5,
                agents: [],
                sources: {},
            }), 'utf8');
            vi.spyOn(SourceResolver.prototype, 'resolve').mockReturnValue(resolvedSource);

            const manager = createManager({ cwd: workspaceDir });
            await expect(manager.runSync({ update: true })).resolves.toMatchObject({
                status: 'completed',
                lockWritten: true,
            });

            const localSkillPath = path.join(workspaceDir, '.agents', 'skills', 'example', 'SKILL.md');
            const lockPath = path.join(workspaceDir, 'skills.lock.json');
            const initialLock = fs.readFileSync(lockPath, 'utf8');
            const updatedSkill = [
                '---',
                'name: Example',
                'description: Example skill',
                'shared_files:',
                '  - shared/config.json',
                '---',
                '',
                '# Updated upstream',
                '',
            ].join('\n');
            fs.writeFileSync(path.join(sourceDir, '.agents', 'skills', 'example', 'SKILL.md'), updatedSkill, 'utf8');
            commitSourceRepository(sourceDir, 'update upstream skill');

            await expect(manager.runSync()).resolves.toMatchObject({
                status: 'completed',
                lockWritten: false,
                preflight: { conflicts: [] },
            });
            expect(fs.readFileSync(localSkillPath, 'utf8')).not.toBe(updatedSkill);
            expect(fs.readFileSync(lockPath, 'utf8')).toBe(initialLock);

            await expect(manager.runSync({ update: true })).resolves.toMatchObject({
                status: 'completed',
                lockWritten: true,
            });
            expect(fs.readFileSync(localSkillPath, 'utf8')).toBe(updatedSkill);
            expect(fs.readFileSync(lockPath, 'utf8')).not.toBe(initialLock);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('syncs published local changes without a false conflict', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/source';
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
            createSourceRepository(sourceDir);
            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                agents: ['codex'],
                sources: [{ source: sourceName }],
            }), 'utf8');
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), JSON.stringify({
                schemaVersion: 5,
                generatedAt: new Date().toISOString(),
                agents: [],
                sources: {},
            }), 'utf8');
            vi.spyOn(SourceResolver.prototype, 'resolve').mockReturnValue(resolvedSource);

            const manager = createManager({ cwd: workspaceDir });
            const initialSync = await manager.runSync({ update: true });
            expect(initialSync.status).toBe('completed');

            const localSkillPath = path.join(workspaceDir, '.agents', 'skills', 'example', 'SKILL.md');
            const localSharedPath = path.join(workspaceDir, '.agents', 'skills', 'shared', 'config.json');
            const publishedSkill = [
                '---',
                'name: Example',
                'description: Example skill',
                'shared_files:',
                '  - shared/config.json',
                '---',
                '',
                '# Published',
                '',
            ].join('\n');
            fs.writeFileSync(localSkillPath, publishedSkill, 'utf8');
            fs.writeFileSync(localSharedPath, '{"enabled":false}\n', 'utf8');

            fs.writeFileSync(path.join(sourceDir, '.agents', 'skills', 'example', 'SKILL.md'), publishedSkill, 'utf8');
            fs.writeFileSync(path.join(sourceDir, '.agents', 'skills', 'shared', 'config.json'), '{"enabled":false}\n', 'utf8');
            commitSourceRepository(sourceDir, 'published local changes');

            const result = await manager.runSync({ update: true });

            expect(result).toMatchObject({
                status: 'completed',
                exitCode: 0,
                lockWritten: true,
                preflight: {
                    ok: true,
                    conflicts: [],
                },
            });
            expect(fs.readFileSync(localSkillPath, 'utf8')).toBe(publishedSkill);
            expect(fs.readFileSync(localSharedPath, 'utf8')).toBe('{"enabled":false}\n');
            const lock = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'skills.lock.json'), 'utf8')) as {
                sources: {
                    [key: string]: {
                        skillEntries: { hash: { treeSha256: string } }[];
                        sharedFileHashes: { path: string; sha256: string }[];
                    };
                };
            };
            expect(lock.sources[sourceName].skillEntries[0].hash.treeSha256).toEqual(expect.any(String));
            expect(lock.sources[sourceName].sharedFileHashes).toHaveLength(1);
            expect(lock.sources[sourceName].sharedFileHashes[0].path).toBe('.agents/skills/shared/config.json');
            expect(lock.sources[sourceName].sharedFileHashes[0].sha256).toEqual(expect.any(String));
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('plans a publish from local changes without mutating the source in dry-run mode', async () => {
        const root = createTempDir();
        const sourceDir = path.join(root, 'source');
        const workspaceDir = path.join(root, 'workspace');
        const sourceName = 'local/source';
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
            createSourceRepository(sourceDir);
            fs.mkdirSync(workspaceDir, { recursive: true });
            fs.writeFileSync(path.join(workspaceDir, 'skills.json'), JSON.stringify({
                agents: ['codex'],
                sources: [{ source: sourceName, publish: { createPr: false } }],
            }), 'utf8');
            fs.writeFileSync(path.join(workspaceDir, 'skills.lock.json'), JSON.stringify({
                schemaVersion: 5,
                generatedAt: new Date().toISOString(),
                agents: [],
                sources: {},
            }), 'utf8');
            vi.spyOn(SourceResolver.prototype, 'resolve').mockReturnValue(resolvedSource);

            const manager = createManager({ cwd: workspaceDir });
            const syncResult = await manager.runSync({ update: true });
            expect(syncResult.status).toBe('completed');

            const localSkillPath = path.join(workspaceDir, '.agents', 'skills', 'example', 'SKILL.md');
            fs.appendFileSync(localSkillPath, '\nLocal change\n', 'utf8');

            const publishResult = await manager.runPublish({
                source: sourceName,
                dryRun: true,
                createPr: false,
            });

            expect(publishResult).toMatchObject({
                status: 'completed',
                exitCode: 0,
                result: {
                    dryRun: true,
                    message: 'Dry-run completed.',
                },
            });
            if (publishResult.status !== 'completed') {
                return;
            }

            expect(publishResult.result.changedFiles).toEqual(expect.arrayContaining([
                { status: 'M', path: '.agents/skills/example/SKILL.md' },
            ]));
            expect(fs.readFileSync(path.join(sourceDir, '.agents', 'skills', 'example', 'SKILL.md'), 'utf8')).not.toContain('Local change');
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

function createSourceRepository(sourceDir: string): void {
    const skillDir = path.join(sourceDir, '.agents', 'skills', 'example');
    const sharedDir = path.join(sourceDir, '.agents', 'skills', 'shared');
    const runner = new GitRunner();
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
        '---',
        'name: Example',
        'description: Example skill',
        'shared_files:',
        '  - shared/config.json',
        '---',
        '',
        '# Example',
        '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(sharedDir, 'config.json'), '{"enabled":true}\n', 'utf8');

    expect(runner.run(null, ['init', sourceDir]).ok).toBe(true);
    expect(runner.run(sourceDir, ['config', 'user.email', 'test@example.com']).ok).toBe(true);
    expect(runner.run(sourceDir, ['config', 'user.name', 'Test User']).ok).toBe(true);
    expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
    expect(runner.run(sourceDir, ['commit', '-m', 'initial']).ok).toBe(true);
}

function commitSourceRepository(sourceDir: string, message: string): void {
    const runner = new GitRunner();
    expect(runner.run(sourceDir, ['add', '.']).ok).toBe(true);
    expect(runner.run(sourceDir, ['commit', '-m', message]).ok).toBe(true);
}
