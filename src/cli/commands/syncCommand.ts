import fs from 'node:fs';

import { createManager } from '../../core/manager';
import { renderSyncEvent, renderSyncResult } from '../renderers/syncRenderer';

export interface SyncCommandOptions {
    manifest?: string;
    force?: boolean;
}

export async function runSyncCommand(options: SyncCommandOptions): Promise<number> {
    const manager = createManager({
        cwd: process.cwd(),
        manifestPath: options.manifest,
    });

    const result = await manager.runSync({
        force: options.force === true,
        report: renderSyncEvent,
        confirmLocalChanges,
    });

    return renderSyncResult(result);
}

function confirmLocalChanges(): boolean {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('Sync aborted: local change conflicts detected in non-interactive mode.\nRe-run with --force to continue anyway.');
    }

    return askYesNo('Continue sync and overwrite/delete these paths? [y/N] ');
}

function askYesNo(question: string): boolean {
    process.stdout.write(question);
    const answerBuffer = Buffer.alloc(128);
    const bytesRead = fs.readSync(process.stdin.fd, answerBuffer, 0, answerBuffer.length, null);
    const answer = answerBuffer.toString('utf8', 0, bytesRead).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
}
