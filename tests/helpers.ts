import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect } from 'vitest';

import SkillDiscovery from '../src/core/source/SkillDiscovery';
import GitSourceClient from '../src/core/source/GitSourceClient';

export function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'lsm-test-'));
}

export function writeJson(filePath: string, value: unknown): void {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readJson(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

export function createLocalCloneDiscovery(cloneDir: string): SkillDiscovery {
    const discovery = new SkillDiscovery();
    discovery.resolveSource = (): ReturnType<SkillDiscovery['resolveSource']> => ({
        ok: true,
        handler: 'github',
        provider: 'github',
        url: 'https://github.com/owner/repo.git',
        ref: null,
        subpath: null,
        webUrl: 'https://github.com/owner/repo',
    });
    discovery.gitSourceClient = {
        cloneRepo: (): ReturnType<GitSourceClient['cloneRepo']> => ({ ok: true, dir: cloneDir }),
        detectDefaultBranch: (): string => 'main',
        gitCapture: (cwd: string, args: string[]): ReturnType<GitSourceClient['gitCapture']> => {
            expect(cwd).toBe(cloneDir);
            const command = args.join(' ');
            if (command === 'rev-parse HEAD') {
                return { ok: true, stdout: 'abc123\n', stderr: '' };
            }
            if (command === 'rev-parse --abbrev-ref HEAD') {
                return { ok: true, stdout: 'main\n', stderr: '' };
            }
            return { ok: false, stdout: '', stderr: `Unexpected git command: ${command}` };
        },
        cleanupTempDir: (dir: string | null | undefined): void => {
            expect(dir).toBe(cloneDir);
        },
    };
    return discovery;
}

export function writeSkillMd(skillDir: string, content: string): void {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `${content}\n`, 'utf8');
}
