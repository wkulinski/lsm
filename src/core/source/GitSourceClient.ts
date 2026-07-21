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

    public cloneRepo({ url, ref, commit = null, depth = null }: { url: string; ref: string | null; commit?: string | null; depth?: number | null }): CloneRepoSuccess | CloneRepoFailure {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
        const args = ['clone'];
        if (typeof depth === 'number' && Number.isInteger(depth) && depth > 0) {
            args.push('--depth', String(depth));
        }
        if (ref && !commit) {
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

        if (commit) {
            const checkout = this.checkoutCommit(tempDir, commit);
            if (!checkout.ok) {
                this.cleanupTempDir(tempDir);
                return checkout;
            }
        }

        return { ok: true, dir: tempDir };
    }

    private checkoutCommit(tempDir: string, commit: string): CloneRepoFailure | { ok: true } {
        const runner = this.gitRunner ?? new GitRunner();
        const fetched = runner.run(tempDir, ['fetch', '--depth', '1', 'origin', commit]);
        if (!fetched.ok) {
            return { ok: false, error: `Git fetch failed for commit ${commit} (exit=${String(fetched.status)})`, details: fetched.stderr || fetched.stdout };
        }

        const checkout = runner.run(tempDir, ['checkout', '--detach', commit]);
        if (!checkout.ok) {
            return { ok: false, error: `Git checkout failed for commit ${commit} (exit=${String(checkout.status)})`, details: checkout.stderr || checkout.stdout };
        }

        const head = this.gitCapture(tempDir, ['rev-parse', 'HEAD']);
        if (!head.ok || head.stdout.trim() !== commit) {
            return { ok: false, error: `Git checkout resolved to an unexpected commit; expected ${commit}.`, details: head.stderr || head.stdout };
        }

        return { ok: true };
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
