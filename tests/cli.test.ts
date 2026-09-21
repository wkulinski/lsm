import fs from 'node:fs';

import { afterEach, describe, expect, test, vi } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };
import { runCli } from '../src/cli/cli';
import { runPublishCommand } from '../src/cli/commands/publishCommand';
import { runSyncCommand } from '../src/cli/commands/syncCommand';
import { createTempDir, writeJson } from './helpers';

describe('CLI composition', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test.each(['--help', '-h'])('shows top-level help for %s', async (helpOption) => {
        let output = '';
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
            output += String(chunk);
            return true;
        });

        await expect(runCli([helpOption])).resolves.toBe(0);
        expect(output).toContain('Usage: lsm [options] [command]');
        expect(output).toContain('sync');
        expect(output).toContain('publish');
        expect(output).toContain('Synchronize managed skills, OpenCode subagents and plugins');
        expect(output).not.toContain('Usage: lsm sync [options]');
    });

    test.each(['--version', '-V'])('shows the package version for %s', async (versionOption) => {
        const tempDir = createTempDir();
        let output = '';
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
            output += String(chunk);
            return true;
        });
        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

        try {
            await expect(runCli([versionOption])).resolves.toBe(0);
            expect(output).toBe(`${packageJson.version}\n`);
            expect(cwdSpy).not.toHaveBeenCalled();
            expect(fs.readdirSync(tempDir)).toEqual([]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('defaults to sync when no command is provided', async () => {
        const tempDir = createTempDir();
        vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

        try {
            await expect(runCli([])).resolves.toBe(1);
            expect(fs.existsSync(`${tempDir}/skills.json`)).toBe(true);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('returns commander errors for unknown commands and options', async () => {
        await expect(runCli(['unknown'])).resolves.toBe(1);
        await expect(runCli(['sync', '--unknown'])).resolves.toBe(1);
    });

    test('sync command creates missing config templates in the current project', async () => {
        const tempDir = createTempDir();
        vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

        try {
            await expect(runSyncCommand({})).resolves.toBe(1);
            expect(fs.existsSync(`${tempDir}/skills.json`)).toBe(true);
            expect(fs.existsSync(`${tempDir}/skills.lock.json`)).toBe(true);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('publish command reports source selection errors before execution', async () => {
        const tempDir = createTempDir();
        vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
        writeJson(`${tempDir}/skills.json`, {
            schemaVersion: 2,
            agents: ['codex'],
            sources: [
                { source: 'owner/repo-a', skills: true },
                { source: 'owner/repo-b', skills: true },
            ],
        });
        writeJson(`${tempDir}/skills.lock.json`, {
            schemaVersion: 5,
            generatedAt: new Date().toISOString(),
            agents: ['codex'],
            sources: {},
        });

        try {
            await expect(runPublishCommand({ dryRun: true })).resolves.toBe(1);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
