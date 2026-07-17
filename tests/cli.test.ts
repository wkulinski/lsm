import fs from 'node:fs';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { runCli } from '../src/cli/cli';
import { runPublishCommand } from '../src/cli/commands/publishCommand';
import { runSyncCommand } from '../src/cli/commands/syncCommand';
import { createTempDir, writeJson } from './helpers';

describe('CLI composition', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('keeps help handling in the top-level CLI', async () => {
        await expect(runCli(['--help'])).resolves.toBe(0);
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
            agents: ['codex'],
            sources: [
                { source: 'owner/repo-a' },
                { source: 'owner/repo-b' },
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
