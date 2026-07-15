import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import GitRunner, { type GitRunnerLike } from '../git/GitRunner';

export interface CloneRepoSuccess {
    ok: true;
    dir: string;
}

export interface CloneRepoFailure {
    ok: false;
    error: string;
    details?: string;
}

export interface GitCaptureResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}

export default class GitSourceClient {
    public gitRunner?: GitRunnerLike;

    public constructor({ gitRunner = new GitRunner() }: { gitRunner?: GitRunnerLike } = {}) {
        this.gitRunner = gitRunner;
    }

    public cloneRepo({ url, ref, depth = null }: { url: string; ref: string | null; depth?: number | null }): CloneRepoSuccess | CloneRepoFailure {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
        const args = ['clone'];
        if (typeof depth === 'number' && Number.isInteger(depth) && depth > 0) {
            args.push('--depth', String(depth));
        }
        if (ref) {
            args.push('--branch', ref);
        }
        args.push(url, tempDir);

        const res = (this.gitRunner ?? new GitRunner()).run(null, args);
        if (res.errorCode === 'ENOENT') {
            this.cleanupTempDir(tempDir);
            return { ok: false, error: 'git not found in PATH' };
        }
        if (!res.ok) {
            this.cleanupTempDir(tempDir);
            return { ok: false, error: `Git clone failed (exit=${String(res.status)})`, details: res.stderr || res.stdout };
        }

        return { ok: true, dir: tempDir };
    }

    public detectDefaultBranch(url: string): string | null {
        const res = (this.gitRunner ?? new GitRunner()).run(null, ['ls-remote', '--symref', url, 'HEAD']);
        if (!res.ok) {
            return null;
        }

        const output = `${res.stdout}${res.stderr}`;
        const match = /ref:\s+refs\/heads\/([^\s]+)\s+HEAD/.exec(output);
        return match ? match[1] : null;
    }

    public gitCapture(cwd: string, args: string[]): GitCaptureResult {
        const res = (this.gitRunner ?? new GitRunner()).run(cwd, args);
        return {
            ok: res.status === 0,
            stdout: res.stdout,
            stderr: res.stderr,
        };
    }

    public cleanupTempDir(dir: string | null | undefined): void {
        if (!dir) {
            return;
        }
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        catch {
            // best-effort cleanup
        }
    }
}
