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

            const result = await createManager({ cwd: workspaceDir }).runSync();

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
            const syncResult = await manager.runSync();
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
