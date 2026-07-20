import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import GitRunner from '../src/core/git/GitRunner';
import PublishWorkspace, { type PublishGitResult, type PublishGitRunner } from '../src/core/publish/PublishWorkspace';
import { createTempDir } from './helpers';

describe('PublishWorkspace', () => {
    test('applies directory, file, and delete plan items inside the cloned workspace', () => {
        const tempDir = createTempDir();

        try {
            const localSkillDir = path.join(tempDir, 'local', 'alpha');
            const localSharedFile = path.join(tempDir, 'local', 'shared', 'common.md');
            const cloneDir = path.join(tempDir, 'clone');
            writeFile(path.join(localSkillDir, 'SKILL.md'), '# Alpha\n');
            writeFile(path.join(localSkillDir, 'nested', 'notes.md'), '# Notes\n');
            writeFile(localSharedFile, '# Shared\n');
            writeFile(path.join(cloneDir, '.agents', 'skills', 'old', 'SKILL.md'), '# Old\n');
            writeFile(path.join(cloneDir, '.agents', 'skills', 'shared', 'stale.md'), '# Stale\n');
            fs.symlinkSync(path.join(localSkillDir, 'SKILL.md'), path.join(localSkillDir, 'linked.md'));

            const workspace = new PublishWorkspace();
            const stagedPaths = workspace.applyPlan([
                {
                    type: 'directory',
                    localPath: localSkillDir,
                    targetPath: '.agents/skills/alpha',
                },
                {
                    type: 'file',
                    localPath: localSharedFile,
                    targetPath: '.agents/skills/shared/common.md',
                    isSharedFile: true,
                },
                {
                    type: 'delete',
                    deleteKind: 'directory',
                    targetPath: '.agents/skills/old',
                    skillName: 'Old',
                },
                {
                    type: 'delete',
                    deleteKind: 'file',
                    targetPath: '.agents/skills/shared/stale.md',
                    isSharedFile: true,
                },
                {
                    type: 'file',
                    localPath: localSharedFile,
                    targetPath: '../escape.md',
                    isSharedFile: true,
                },
            ], cloneDir);

            expect(stagedPaths).toEqual([
                '.agents/skills/alpha/nested/notes.md',
                '.agents/skills/alpha/SKILL.md',
                '.agents/skills/old',
                '.agents/skills/shared/common.md',
                '.agents/skills/shared/stale.md',
            ]);
            expect(fs.readFileSync(path.join(cloneDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('# Alpha\n');
            expect(fs.readFileSync(path.join(cloneDir, '.agents', 'skills', 'alpha', 'nested', 'notes.md'), 'utf8')).toBe('# Notes\n');
            expect(fs.existsSync(path.join(cloneDir, '.agents', 'skills', 'alpha', 'linked.md'))).toBe(false);
            expect(fs.readFileSync(path.join(cloneDir, '.agents', 'skills', 'shared', 'common.md'), 'utf8')).toBe('# Shared\n');
            expect(fs.existsSync(path.join(cloneDir, '.agents', 'skills', 'old'))).toBe(false);
            expect(fs.existsSync(path.join(cloneDir, '.agents', 'skills', 'shared', 'stale.md'))).toBe(false);
            expect(fs.existsSync(path.join(tempDir, 'escape.md'))).toBe(false);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('stages applied paths and parses changed files with an injected git runner', () => {
        const tempDir = createTempDir();

        try {
            const sourceFile = path.join(tempDir, 'local', 'file.md');
            const cloneDir = path.join(tempDir, 'clone');
            writeFile(sourceFile, '# File\n');
            fs.mkdirSync(cloneDir, { recursive: true });

            const gitCalls: { cwd: string; args: string[] }[] = [];
            const workspace = new PublishWorkspace({
                gitRunner: createGitRunner(gitCalls, {
                    diffStdout: 'A\t.agents/skills/shared/file.md\nM\t.agents/skills/alpha/SKILL.md\n',
                }),
            });

            const result = workspace.stagePublishPlan({
                cloneDir,
                planItems: [{
                    type: 'file',
                    localPath: sourceFile,
                    targetPath: '.agents/skills/shared/file.md',
                    isSharedFile: true,
                }],
            });

            expect(result).toEqual({
                ok: true,
                changedFiles: [
                    { status: 'A', path: '.agents/skills/shared/file.md' },
                    { status: 'M', path: '.agents/skills/alpha/SKILL.md' },
                ],
            });
            expect(gitCalls).toEqual([
                {
                    cwd: cloneDir,
                    args: ['add', '-f', '--', '.agents/skills/shared/file.md'],
                },
                {
                    cwd: cloneDir,
                    args: ['diff', '--cached', '--name-status'],
                },
            ]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('force-stages managed files below an ignored skills directory', () => {
        const tempDir = createTempDir();
        const cloneDir = path.join(tempDir, 'clone');
        const localExistingSkill = path.join(tempDir, 'local', 'llm-skills-manager', 'SKILL.md');
        const localNewSkill = path.join(tempDir, 'local', 'new-skill', 'SKILL.md');
        const existingTarget = path.join(cloneDir, '.agents', 'skills', 'llm-skills-manager', 'SKILL.md');

        try {
            writeFile(path.join(cloneDir, '.gitignore'), '/.agents/skills/\n!/.agents/skills/llm-skills-manager/\n');
            writeFile(existingTarget, '# Original\n');
            writeFile(localExistingSkill, '# Updated\n');
            writeFile(localNewSkill, '# New\n');

            const git = new GitRunner();
            expect(git.run(null, ['init', cloneDir]).ok).toBe(true);
            expect(git.run(cloneDir, ['config', 'user.email', 'test@example.com']).ok).toBe(true);
            expect(git.run(cloneDir, ['config', 'user.name', 'Test User']).ok).toBe(true);
            expect(git.run(cloneDir, ['add', '-f', '--', '.gitignore', '.agents/skills/llm-skills-manager/SKILL.md']).ok).toBe(true);
            expect(git.run(cloneDir, ['commit', '-m', 'initial']).ok).toBe(true);

            const workspace = new PublishWorkspace({
                gitRunner: (cwd, args): PublishGitResult => git.run(cwd, args),
            });
            const result = workspace.stagePublishPlan({
                cloneDir,
                planItems: [
                    {
                        type: 'file',
                        localPath: localExistingSkill,
                        targetPath: '.agents/skills/llm-skills-manager/SKILL.md',
                    },
                    {
                        type: 'directory',
                        localPath: path.dirname(localNewSkill),
                        targetPath: '.agents/skills/new-skill',
                    },
                ],
            });

            expect(result).toEqual({
                ok: true,
                changedFiles: [
                    { status: 'M', path: '.agents/skills/llm-skills-manager/SKILL.md' },
                    { status: 'A', path: '.agents/skills/new-skill/SKILL.md' },
                ],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('returns staging no-op and git-add failure results', () => {
        const tempDir = createTempDir();

        try {
            const cloneDir = path.join(tempDir, 'clone');
            const sourceFile = path.join(tempDir, 'local', 'file.md');
            fs.mkdirSync(cloneDir, { recursive: true });
            writeFile(sourceFile, '# File\n');

            expect(new PublishWorkspace().stagePublishPlan({
                cloneDir,
                planItems: [],
            })).toEqual({
                ok: true,
                result: { message: 'No file changes detected after applying publish plan.' },
            });

            const failingWorkspace = new PublishWorkspace({
                gitRunner: createGitRunner([], {
                    addOk: false,
                    addStderr: 'cannot add',
                }),
            });
            expect(failingWorkspace.stagePublishPlan({
                cloneDir,
                planItems: [{
                    type: 'file',
                    localPath: sourceFile,
                    targetPath: '.agents/skills/shared/file.md',
                    isSharedFile: true,
                }],
            })).toEqual({
                ok: false,
                error: 'Failed to stage publish changes.',
                details: 'cannot add',
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('formats default branch names', () => {
        const workspace = new PublishWorkspace();

        expect(workspace.defaultBranchName('abcdef1234567890', 'publish/custom/')).toMatch(
            /^publish\/custom-\d{8}T\d{6}-abcdef12$/,
        );
        expect(workspace.defaultBranchName('abcdef1234567890')).toMatch(
            /^skills-sync\/publish-\d{8}T\d{6}-abcdef12$/,
        );
    });

    test('uses a default branch for a whitespace-only branch option', () => {
        const tempDir = createTempDir();
        const calls: { cwd: string; args: string[] }[] = [];

        try {
            const workspace = new PublishWorkspace({
                gitRunner: (cwd, args): PublishGitResult => {
                    calls.push({ cwd, args });
                    return {
                        ok: true,
                        status: 0,
                        stdout: '',
                        stderr: '',
                    };
                },
            });
            const result = workspace.preparePublishWorkspace({
                sourceInfo: {
                    ok: true,
                    handler: 'github',
                    provider: 'github',
                    url: 'https://github.com/owner/repo.git',
                    ref: null,
                    subpath: null,
                    webUrl: 'https://github.com/owner/repo',
                },
                resolvedCommit: 'abcdef1234567890',
                branch: '   ',
                publishConfig: { branchPrefix: 'publish/custom', createPr: null },
            });

            expect(result).toMatchObject({ ok: true });
            if (result.ok) {
                expect(result.branchName).toMatch(/^publish\/custom-\d{8}T\d{6}-abcdef12$/);
                workspace.cleanupTempDir(result.cloneDir);
            }
            expect(calls[1]?.args[0]).toBe('cat-file');
            expect(calls[2]?.args[0]).toBe('checkout');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects publish targets that contain a symbolic link', () => {
        const tempDir = createTempDir();

        try {
            const cloneDir = path.join(tempDir, 'clone');
            const outsideFile = path.join(tempDir, 'outside.md');
            const targetDir = path.join(cloneDir, '.agents', 'skills', 'alpha');
            const targetLink = path.join(targetDir, 'shared.md');
            const sourceFile = path.join(tempDir, 'local.md');
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(outsideFile, 'outside\n', 'utf8');
            fs.writeFileSync(sourceFile, 'replacement\n', 'utf8');
            fs.symlinkSync(outsideFile, targetLink);

            expect(() => new PublishWorkspace().applyPlan([{
                type: 'file',
                localPath: sourceFile,
                targetPath: '.agents/skills/alpha/shared.md',
            }], cloneDir)).toThrow('contains a symbolic link');
            expect(fs.readFileSync(outsideFile, 'utf8')).toBe('outside\n');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

function createGitRunner(
    calls: { cwd: string; args: string[] }[],
    {
        addOk = true,
        addStderr = '',
        diffStdout = '',
    }: {
        addOk?: boolean;
        addStderr?: string;
        diffStdout?: string;
    },
): PublishGitRunner {
    return (cwd: string, args: string[]) => {
        calls.push({ cwd, args });
        const command = args.join(' ');
        if (command.startsWith('add -f -- ')) {
            return {
                ok: addOk,
                status: addOk ? 0 : 1,
                stdout: '',
                stderr: addStderr,
            };
        }
        if (command === 'diff --cached --name-status') {
            return {
                ok: true,
                status: 0,
                stdout: diffStdout,
                stderr: '',
            };
        }
        return {
            ok: false,
            status: 1,
            stdout: '',
            stderr: `Unexpected git command: ${command}`,
        };
    };
}

function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}
