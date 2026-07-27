import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

import SubagentDiscovery from '../src/core/source/SubagentDiscovery';
import SourceWorkspace, { type SourceWorkspaceGitClient } from '../src/core/source/SourceWorkspace';
import SkillDiscovery from '../src/core/source/SkillDiscovery';
import type { ResolvedSource } from '../src/core/types';
import { createSubagentSourceRepository } from './fixtures/subagentSource';
import { createTempDir } from './helpers';

describe('SourceWorkspace', () => {
    test('shares one checkout between skill and subagent discovery', () => {
        const sourceDir = createTempDir();
        const projectRoot = createTempDir();
        const calls = { clone: 0, cleanup: 0 };
        const cloneOptions: unknown[] = [];

        try {
            createSubagentSourceRepository(sourceDir);
            const workspace = new SourceWorkspace({
                resolveSource: (): ResolvedSource => createResolvedSource(),
                gitSourceClient: {
                    cloneRepo: (options: Parameters<SourceWorkspaceGitClient['cloneRepo']>[0]): ReturnType<SourceWorkspaceGitClient['cloneRepo']> => {
                        calls.clone += 1;
                        cloneOptions.push(options);
                        return { ok: true, dir: sourceDir };
                    },
                    detectDefaultBranch: (): string => 'main',
                    gitCapture: (_cwd: string, args: string[]): ReturnType<SourceWorkspaceGitClient['gitCapture']> => ({
                        ok: true,
                        stdout: args.join(' ') === 'rev-parse HEAD' ? 'abc123\n' : 'main\n',
                        stderr: '',
                    }),
                    cleanupTempDir: (): void => {
                        calls.cleanup += 1;
                    },
                },
            });

            const result = workspace.withWorkspace('owner/repo', { resolvedCommit: 'locked-commit' }, session => ({
                skills: new SkillDiscovery().discoverWorkspace(session),
                subagents: new SubagentDiscovery().discoverWorkspace(session, { projectRoot }),
            }));

            expect(calls).toEqual({ clone: 1, cleanup: 1 });
            expect(cloneOptions).toEqual([{
                url: 'https://github.com/owner/repo.git',
                ref: null,
                commit: 'locked-commit',
                depth: 1,
            }]);
            expect(result).toMatchObject({
                skills: {
                    skills: [{ name: 'Example' }],
                },
                subagents: {
                    ok: true,
                    subagents: [{
                        name: 'reviewer',
                        sourcePath: '.opencode/agent/reviewer.md',
                        targetPath: '.opencode/agents/reviewer.md',
                        hash: { executable: false },
                    }],
                    sharedFiles: [
                        { path: '.agents/skills/_shared/references/runtime-quality-procedures.md' },
                        { path: '.agents/skills/_shared/scripts/context-manifest.mjs' },
                    ],
                },
            });
        }
        finally {
            fs.rmSync(sourceDir, { recursive: true, force: true });
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    test('cleans the checkout when discovery throws', () => {
        const sourceDir = createTempDir();
        let cleanupCount = 0;

        try {
            const workspace = new SourceWorkspace({
                resolveSource: (): ResolvedSource => createResolvedSource(),
                gitSourceClient: {
                    cloneRepo: (): ReturnType<SourceWorkspaceGitClient['cloneRepo']> => ({ ok: true, dir: sourceDir }),
                    detectDefaultBranch: (): null => null,
                    gitCapture: (): ReturnType<SourceWorkspaceGitClient['gitCapture']> => ({ ok: true, stdout: '', stderr: '' }),
                    cleanupTempDir: (): void => {
                        cleanupCount += 1;
                    },
                },
            });

            expect(() => workspace.withWorkspace('owner/repo', {}, () => {
                throw new Error('discovery failed');
            })).toThrow('discovery failed');
            expect(cleanupCount).toBe(1);
        }
        finally {
            fs.rmSync(sourceDir, { recursive: true, force: true });
        }
    });

    test('does not invoke discovery or cleanup when clone fails', () => {
        let callbackCalled = false;
        let cleanupCalled = false;
        const workspace = new SourceWorkspace({
            resolveSource: (): ResolvedSource => createResolvedSource(),
            gitSourceClient: {
                cloneRepo: (): ReturnType<SourceWorkspaceGitClient['cloneRepo']> => ({ ok: false, error: 'clone failed', details: 'network unavailable' }),
                detectDefaultBranch: (): string => 'main',
                gitCapture: (): ReturnType<SourceWorkspaceGitClient['gitCapture']> => ({ ok: true, stdout: '', stderr: '' }),
                cleanupTempDir: (): void => {
                    cleanupCalled = true;
                },
            },
        });

        const result = workspace.withWorkspace('owner/repo', {}, () => {
            callbackCalled = true;
            return 'unexpected';
        });

        expect(result).toEqual({ ok: false, error: 'clone failed', details: 'network unavailable' });
        expect(callbackCalled).toBe(false);
        expect(cleanupCalled).toBe(false);
    });

    test('resolves skills and subagents relative to the checked out source subpath', () => {
        const sourceDir = createTempDir();
        const projectRoot = createTempDir();

        try {
            fs.mkdirSync(`${sourceDir}/nested/.agents/skills/example`, { recursive: true });
            fs.writeFileSync(`${sourceDir}/nested/.agents/skills/example/SKILL.md`, [
                '---',
                'name: Nested Skill',
                'description: Nested skill',
                '---',
                '',
            ].join('\n'), 'utf8');
            fs.mkdirSync(`${sourceDir}/nested/.opencode/agent`, { recursive: true });
            fs.writeFileSync(`${sourceDir}/nested/.opencode/agent/reviewer.md`, '# Reviewer\n', 'utf8');

            const workspace = new SourceWorkspace({
                resolveSource: (): ResolvedSource => createResolvedSource('nested'),
                gitSourceClient: {
                    cloneRepo: (): ReturnType<SourceWorkspaceGitClient['cloneRepo']> => ({ ok: true, dir: sourceDir }),
                    detectDefaultBranch: (): string => 'main',
                    gitCapture: (_cwd: string, args: string[]): ReturnType<SourceWorkspaceGitClient['gitCapture']> => ({
                        ok: true,
                        stdout: args.join(' ') === 'rev-parse HEAD' ? 'abc123\n' : 'main\n',
                        stderr: '',
                    }),
                    cleanupTempDir: (): void => { /* no-op */ },
                },
            });

            const result = workspace.withWorkspace('owner/repo', {}, session => ({
                skills: new SkillDiscovery().discoverWorkspace(session),
                subagents: new SubagentDiscovery().discoverWorkspace(session, { projectRoot }),
            }));

            expect(result).toMatchObject({
                skills: { skills: [{ name: 'Nested Skill' }] },
                subagents: {
                    ok: true,
                    subagents: [{ sourcePath: '.opencode/agent/reviewer.md' }],
                },
            });
        }
        finally {
            fs.rmSync(sourceDir, { recursive: true, force: true });
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });
});

function createResolvedSource(subpath: string | null = null): ResolvedSource {
    return {
        ok: true,
        handler: 'github',
        provider: 'github',
        url: 'https://github.com/owner/repo.git',
        ref: null,
        subpath,
        webUrl: 'https://github.com/owner/repo',
    };
}
