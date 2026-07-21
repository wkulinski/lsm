import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import GitSourceClient from '../src/core/source/GitSourceClient';
import type { GitRunnerLike } from '../src/core/git/GitRunner';
import { createTempDir } from './helpers';

describe('GitSourceClient', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('captures git command output without network access', () => {
        const client = new GitSourceClient();

        const result = client.gitCapture(process.cwd(), ['--version']);

        expect(result.ok).toBe(true);
        expect(result.stdout).toContain('git version');
        expect(result.stderr).toBe('');
    });

    test('cleans temporary directories defensively', () => {
        const tempDir = createTempDir();
        const nestedFile = path.join(tempDir, 'nested', 'file.txt');
        fs.mkdirSync(path.dirname(nestedFile), { recursive: true });
        fs.writeFileSync(nestedFile, 'temporary\n', 'utf8');

        const client = new GitSourceClient();

        client.cleanupTempDir(tempDir);
        client.cleanupTempDir(null);

        expect(fs.existsSync(tempDir)).toBe(false);
    });

    test('clones with valid depth and ref arguments', () => {
        const calls: { cwd: string | null; args: string[] }[] = [];
        const client = new GitSourceClient({
            gitRunner: createRunner(calls, { ok: true }),
        });

        const result = client.cloneRepo({ url: 'https://github.com/owner/repo.git', ref: 'main', depth: 1 });

        expect(result.ok).toBe(true);
        expect(calls[0]?.args).toEqual(expect.arrayContaining(['clone', '--depth', '1', '--branch', 'main']));
        if (result.ok) {
            client.cleanupTempDir(result.dir);
        }
    });

    test('clones and verifies an exact commit without using a branch ref', () => {
        const calls: { cwd: string | null; args: string[] }[] = [];
        const commit = 'abc123';
        const client = new GitSourceClient({
            gitRunner: {
                run(cwd, args): ReturnType<GitRunnerLike['run']> {
                    calls.push({ cwd, args });
                    if (args[0] === 'rev-parse') {
                        return { ok: true, status: 0, stdout: `${commit}\n`, stderr: '' };
                    }
                    return { ok: true, status: 0, stdout: '', stderr: '' };
                },
            },
        });

        const result = client.cloneRepo({ url: 'https://github.com/owner/repo.git', ref: 'main', commit, depth: 1 });

        expect(result.ok).toBe(true);
        expect(calls.map(call => call.args)).toEqual([
            ['clone', '--depth', '1', 'https://github.com/owner/repo.git', expect.any(String)],
            ['fetch', '--depth', '1', 'origin', commit],
            ['checkout', '--detach', commit],
            ['rev-parse', 'HEAD'],
        ]);
        if (result.ok) {
            client.cleanupTempDir(result.dir);
        }
    });

    test('ignores invalid depth and cleans up failed clones', () => {
        const calls: { cwd: string | null; args: string[] }[] = [];
        const remove = vi.spyOn(fs, 'rmSync');
        const client = new GitSourceClient({
            gitRunner: createRunner(calls, { ok: false, status: 128, stderr: 'not found' }),
        });

        const result = client.cloneRepo({ url: 'owner/repo', ref: null, depth: 0 });

        expect(result).toEqual({ ok: false, error: 'Git clone failed (exit=128)', details: 'not found' });
        expect(calls[0]?.args).toEqual(['clone', 'owner/repo', expect.any(String)]);
        expect(remove).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true });
    });

    test('reports missing git and handles default branch discovery', () => {
        const client = new GitSourceClient({
            gitRunner: createRunner([], { errorCode: 'ENOENT' }),
        });

        expect(client.cloneRepo({ url: 'owner/repo', ref: null })).toEqual({ ok: false, error: 'git not found in PATH' });

        const branchClient = new GitSourceClient({
            gitRunner: createRunner([], { stdout: 'ref: refs/heads/main\tHEAD\n' }),
        });
        expect(branchClient.detectDefaultBranch('owner/repo')).toBe('main');

        const unavailableClient = new GitSourceClient({
            gitRunner: createRunner([], { ok: false }),
        });
        expect(unavailableClient.detectDefaultBranch('owner/repo')).toBeNull();
    });

    test('captures status and output from the injected Git runner', () => {
        const client = new GitSourceClient({
            gitRunner: createRunner([], { ok: false, status: 2, stdout: 'out', stderr: 'err' }),
        });

        expect(client.gitCapture('/tmp/project', ['status'])).toEqual({
            ok: false,
            stdout: 'out',
            stderr: 'err',
        });
    });

    test('swallows cleanup failures', () => {
        const remove = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
            throw new Error('cleanup failed');
        });

        expect(() => {
            new GitSourceClient().cleanupTempDir('/tmp/temporary');
        }).not.toThrow();
        expect(remove).toHaveBeenCalled();
    });
});

function createRunner(
    calls: { cwd: string | null; args: string[] }[],
    overrides: Partial<{
        ok: boolean;
        status: number;
        stdout: string;
        stderr: string;
        errorCode: string;
    }> = {},
): GitRunnerLike {
    return {
        run(cwd, args): ReturnType<GitRunnerLike['run']> {
            calls.push({ cwd, args });
            return {
                ok: overrides.ok ?? true,
                status: overrides.status ?? (overrides.ok === false ? 1 : 0),
                stdout: overrides.stdout ?? '',
                stderr: overrides.stderr ?? '',
                ...(overrides.errorCode ? { errorCode: overrides.errorCode } : {}),
            };
        },
    };
}
