import fs from 'node:fs';

import { afterEach, describe, expect, test, vi } from 'vitest';

import type {
    PublishCommandOptions as CorePublishCommandOptions,
    PublishCommandResult,
    SyncCommandOptions as CoreSyncCommandOptions,
    SyncCommandResult,
    SyncConfirmationRequest,
} from '../src/core/types';
import { createManager } from '../src/core/manager';

vi.mock('../src/core/manager', () => ({
    createManager: vi.fn(),
}));

import { runPublishCommand } from '../src/cli/commands/publishCommand';
import { runSyncCommand } from '../src/cli/commands/syncCommand';

const mockedCreateManager = vi.mocked(createManager);

describe('CLI command handlers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mockedCreateManager.mockReset();
    });

    test('maps sync options and provides event and confirmation callbacks', async () => {
        const runSync = vi.fn<(options: CoreSyncCommandOptions) => Promise<SyncCommandResult>>(() => Promise.resolve({ status: 'cancelled', exitCode: 1 } as SyncCommandResult));
        mockedCreateManager.mockReturnValue({ runSync } as unknown as ReturnType<typeof createManager>);

        await expect(runSyncCommand({ manifest: 'custom.json', force: true })).resolves.toBe(1);

        const options = runSync.mock.calls[0][0];
        expect(options.force).toBe(true);
        expect(typeof options.report).toBe('function');
        expect(typeof options.confirmLocalChanges).toBe('function');
    });

    test('rejects local conflict confirmation in non-interactive mode', async () => {
        let confirmation: ((input: SyncConfirmationRequest) => boolean | Promise<boolean>) | undefined;
        const runSync = vi.fn<(options: CoreSyncCommandOptions) => Promise<SyncCommandResult>>((options) => {
            confirmation = options.confirmLocalChanges;
            return Promise.resolve({ status: 'cancelled', exitCode: 1 } as SyncCommandResult);
        });
        mockedCreateManager.mockReturnValue({ runSync } as unknown as ReturnType<typeof createManager>);
        const stdin = process.stdin as typeof process.stdin & { isTTY?: boolean };
        const stdout = process.stdout as typeof process.stdout & { isTTY?: boolean };
        const originalStdinTTY = stdin.isTTY;
        const originalStdoutTTY = stdout.isTTY;
        stdin.isTTY = false;
        stdout.isTTY = false;

        try {
            await runSyncCommand({});

            expect(confirmation).toBeDefined();
            expect(() => confirmation?.({} as SyncConfirmationRequest)).toThrow(
                'Sync aborted: local change conflicts detected in non-interactive mode.',
            );
        }
        finally {
            stdin.isTTY = originalStdinTTY;
            stdout.isTTY = originalStdoutTTY;
        }
    });

    test('accepts yes and rejects no in interactive confirmation', async () => {
        let confirmation: ((input: SyncConfirmationRequest) => boolean | Promise<boolean>) | undefined;
        const runSync = vi.fn<(options: CoreSyncCommandOptions) => Promise<SyncCommandResult>>((options) => {
            confirmation = options.confirmLocalChanges;
            return Promise.resolve({ status: 'cancelled', exitCode: 1 } as SyncCommandResult);
        });
        mockedCreateManager.mockReturnValue({ runSync } as unknown as ReturnType<typeof createManager>);
        const stdin = process.stdin as typeof process.stdin & { isTTY?: boolean };
        const stdout = process.stdout as typeof process.stdout & { isTTY?: boolean };
        const originalStdinTTY = stdin.isTTY;
        const originalStdoutTTY = stdout.isTTY;
        stdin.isTTY = true;
        stdout.isTTY = true;
        const answers = ['yes', 'n'];
        vi.spyOn(fs, 'readSync').mockImplementation((_fd, buffer) => {
            const answer = answers.shift() ?? '';
            if (Buffer.isBuffer(buffer)) {
                buffer.write(answer);
            }
            return answer.length;
        });

        try {
            await runSyncCommand({});
            expect(confirmation).toBeDefined();
            expect(confirmation?.({} as SyncConfirmationRequest)).toBe(true);
            expect(confirmation?.({} as SyncConfirmationRequest)).toBe(false);
        }
        finally {
            stdin.isTTY = originalStdinTTY;
            stdout.isTTY = originalStdoutTTY;
        }
    });

    test('maps publish options and preserves repeated skill arguments', async () => {
        const runPublish = vi.fn<(options: CorePublishCommandOptions) => Promise<PublishCommandResult>>(() => Promise.resolve({ status: 'error', exitCode: 1, error: 'failed' }));
        mockedCreateManager.mockReturnValue({ runPublish } as unknown as ReturnType<typeof createManager>);

        await expect(runPublishCommand({
            manifest: 'custom.json',
            source: 'owner/repo',
            newSkill: ['one', 'two'],
            removeSkill: ['old'],
            dryRun: true,
            confirmDeletes: true,
            message: 'message',
            branch: 'branch',
            pr: false,
            title: 'title',
            body: 'body',
        })).resolves.toBe(1);

        const options = runPublish.mock.calls[0]?.[0];
        expect(options).toMatchObject({
            source: 'owner/repo',
            newSkills: ['one', 'two'],
            removeSkills: ['old'],
            dryRun: true,
            confirmDeletes: true,
            message: 'message',
            branch: 'branch',
            createPr: false,
            title: 'title',
            body: 'body',
        });
        expect(typeof options.report).toBe('function');
    });
});
