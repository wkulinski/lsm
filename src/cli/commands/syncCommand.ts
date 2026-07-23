import fs from 'node:fs';

import { createManager } from '../../core/manager';
import { renderSyncEvent, renderSyncResult } from '../renderers/syncRenderer';

export interface SyncCommandOptions {
    manifest?: string;
    force?: boolean;
    update?: boolean;
}

export async function runSyncCommand(options: SyncCommandOptions): Promise<number> {
    const manager = createManager({
        cwd: process.cwd(),
        manifestPath: options.manifest,
    });

    const result = await manager.runSync({
        force: options.force === true,
        update: options.update === true,
        report: renderSyncEvent,
        confirmLocalChanges,
    });

    return renderSyncResult(result);
}

function confirmLocalChanges(): boolean {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('Standard sync cannot continue because local changes were detected in managed files.\nThe files differ from the version recorded in skills.lock.json. If these changes were already published upstream, re-run with --update; otherwise review the changes or use --force to overwrite them.');
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
