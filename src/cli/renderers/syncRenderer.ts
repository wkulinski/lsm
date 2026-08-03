import { formatUnknown } from '../../core/utils/formatUnknown';
import type {
    ManagerEvent,
    ManagerHeader,
    ManagerTemplatesCreatedResult,
    SharedSyncError,
    SyncCommandResult,
    SyncInstallResult,
    SyncPlan,
    SyncPreflight,
} from '../../core/types';
import { isObject, printError } from './errorRenderer';
import { colorize, writeBullet, writeSection } from './terminalFormatter';

export function renderSyncEvent(event: ManagerEvent): void {
    switch (event.type) {
        case 'header':
            printHeader(event.header);
            return;
        case 'sync-discover-start':
            writeSection(process.stdout, '-- Discovering skills (prune-missing enabled) --', 'info');
            return;
        case 'sync-plan':
            printSyncPlan(event.plan);
            return;
        case 'sync-preflight':
            printPreflight(event.preflight, event.force);
            return;
        case 'sync-add-start':
            writeSection(process.stdout, '-- Installing desired skills to whitelisted agents --', 'info');
            return;
        case 'sync-add-source':
            writeSection(process.stdout, `>>> Source: ${event.source}`, 'accent');
            process.stdout.write(`    ${colorize('Mode  :', 'muted')} ${event.mode}\n`);
            process.stdout.write(`    ${colorize('Skills:', 'muted')} ${String(event.skillCount)}\n`);
            return;
        case 'sync-shared-start':
            writeSection(process.stdout, '-- Syncing shared files declared in skill frontmatter --', 'info');
            return;
        case 'sync-subagents':
            writeSection(process.stdout, '-- Syncing OpenCode subagents --', 'info');
            return;
        case 'sync-remove-start':
            printRemovalStart(event.plan);
            return;
        case 'publish-start':
            return;
    }
}

export function renderSyncResult(result: SyncCommandResult): number {
    switch (result.status) {
        case 'templates-created':
            printCreatedTemplates(result);
            return result.exitCode;
        case 'error':
            printError(result);
            return result.exitCode;
        case 'cancelled':
            process.stdout.write(`${colorize('Sync cancelled.', 'warning')}\n`);
            return result.exitCode;
        case 'add-failed':
            printInstallSummary(result.installs);
            writeSection(process.stdout, 'Aborting before removals because installs failed.', 'error');
            return result.exitCode;
        case 'shared-failed':
            printSharedErrors(result.shared.errors);
            writeSection(process.stdout, 'Aborting before removals because shared file sync failed.', 'error');
            return result.exitCode;
        case 'subagent-failed':
            printSubagentSummary(result.subagents);
            printSharedErrors(result.subagents.errors);
            writeSection(process.stdout, 'Aborting before removals because subagent sync failed.', 'error');
            return result.exitCode;
        case 'completed':
            printSharedSummary(result);
            if (result.subagents) {
                printSubagentSummary(result.subagents);
            }
            printMissingRequested(result.missingRequested);
            printInstallSummary(result.installs);
            printLockOutcome(result.lockWritten, result.header.lockRelativePath, result.lockMode);
            return result.exitCode;
    }

    return assertNever(result);
}

function printHeader(header: ManagerHeader): void {
    writeSection(process.stdout, '== Skills sync ==', 'heading', false);
    process.stdout.write(`${colorize('CLI     :', 'muted')} ${header.cliVersion}\n`);
    process.stdout.write(`${colorize('Manifest:', 'muted')} ${header.manifestRelativePath}\n`);
    process.stdout.write(`${colorize('Lock    :', 'muted')} ${header.lockRelativePath}\n`);
    process.stdout.write(`${colorize('Agents  :', 'muted')} ${header.agents.join(', ')}\n`);
}

function printCreatedTemplates(result: ManagerTemplatesCreatedResult): void {
    writeSection(process.stdout, 'Brak wymaganych plików. Utworzono szablony:', 'warning');
    result.createdTemplates.forEach((filePath) => {
        writeBullet(process.stdout, filePath);
    });
    process.stdout.write(`${colorize('Uzupełnij skills.json i uruchom ponownie.', 'muted')}\n`);
}

function printSyncPlan(plan: SyncPlan): void {
    writeSection(process.stdout, '-- Plan --', 'heading');
    process.stdout.write(`${colorize('Managed(old):', 'muted')} ${String(plan.oldManaged.length)}\n`);
    process.stdout.write(`${colorize('Managed(new):', 'muted')} ${String(plan.newManaged.length)}\n`);
    process.stdout.write(`${colorize('Skills to remove (prune):', 'muted')} ${String(plan.skillsRemoved.length)}\n`);
    process.stdout.write(`${colorize('Agents removed from whitelist:', 'muted')} ${String(plan.agentsRemoved.length)}\n`);
}

function printPreflight(preflight: SyncPreflight, force: boolean): void {
    writeSection(process.stdout, '-- Local change guard --', 'warning');
    process.stdout.write(`${colorize('Standard sync cannot continue because local changes were detected in managed files.', 'warning')}\n`);
    process.stdout.write('The affected files differ from the version recorded in skills.lock.json. If these changes were already published upstream, re-run with --update to resolve the current upstream and refresh the lock.\n');
    process.stdout.write(`${colorize('Detected potential overwrite/delete conflicts:', 'muted')} ${String(preflight.conflicts.length)}\n`);
    preflight.conflicts.forEach((conflict) => {
        const operation = conflict.operation === 'delete' ? 'delete' : 'overwrite';
        writeBullet(process.stdout, `[${operation}] ${conflict.path} (${describeConflictReason(conflict.reason)})`, operation === 'delete' ? 'warning' : 'info');
    });

    if (force) {
        process.stdout.write(`${colorize('Continuing because --force was provided.', 'warning')}\n`);
    }
}

function printRemovalStart(plan: SyncPlan): void {
    if (plan.agentsRemoved.length > 0 && plan.oldManaged.length > 0) {
        writeSection(process.stdout, `-- Removing managed skills from removed agents: ${plan.agentsRemoved.join(', ')} --`, 'warning');
    }

    if (plan.skillsRemoved.length > 0 && plan.agentsUnion.length > 0) {
        writeSection(process.stdout, `-- Pruning removed/missing skills from agents: ${plan.agentsUnion.join(', ')} --`, 'warning');
        return;
    }

    writeSection(process.stdout, '-- Nothing to prune --', 'muted');
}

function printSharedSummary(result: Extract<SyncCommandResult, { status: 'completed' }>): void {
    const sourcesWithSharedFiles = Object.entries(result.shared.sharedStats)
        .filter(([, stats]) => stats.declaredFiles > 0)
        .map(([source]) => source);

    writeSection(process.stdout, '== Shared files summary ==', 'heading');
    if (sourcesWithSharedFiles.length === 0) {
        process.stdout.write(`${colorize('No shared files declared.', 'muted')}\n`);
        return;
    }

    sourcesWithSharedFiles.forEach((source) => {
        const stats = result.shared.sharedStats[source] ?? { declaredFiles: 0, copiedFiles: 0 };
        const managedCount = (result.shared.managedNewLocalPaths[source] ?? []).length;
        writeBullet(process.stdout, source, 'accent');
        process.stdout.write(`  ${colorize('declared files:', 'muted')} ${String(stats.declaredFiles)}\n`);
        process.stdout.write(`  ${colorize('copied files  :', 'muted')} ${String(stats.copiedFiles)}\n`);
        process.stdout.write(`  ${colorize('managed files:', 'muted')} ${String(managedCount)}\n`);
    });
    process.stdout.write(`${colorize('Pruned shared files:', 'muted')} ${String(result.shared.removedFiles ?? 0)}\n`);
}

function printSharedErrors(errors: SharedSyncError[]): void {
    errors.forEach((error) => {
        if (error.source) {
            process.stderr.write(`\n${colorize(error.message, 'error', process.stderr)} ${colorize(error.source, 'accent', process.stderr)}\n`);
        }
        else {
            process.stderr.write(`\n${colorize(error.message, 'error', process.stderr)}\n`);
        }

        if (Array.isArray(error.details)) {
            error.details.forEach((entry) => {
                if (isObject(entry) && typeof entry.filePath === 'string' && typeof entry.a === 'string' && typeof entry.b === 'string') {
                    writeBullet(process.stderr, `"${entry.filePath}" in: ${entry.a} AND ${entry.b}`, 'muted', '   ');
                    return;
                }
                writeBullet(process.stderr, formatUnknown(entry), 'muted', '   ');
            });
            return;
        }

        if (error.details) {
            process.stderr.write(`   ${colorize(formatUnknown(error.details), 'muted', process.stderr)}\n`);
        }
    });
}

function printSubagentSummary(summary: {
    detected: number;
    installed: number;
    removed: number;
    sharedFiles: number;
}): void {
    writeSection(process.stdout, '== Subagents summary ==', 'heading');
    process.stdout.write(`${colorize('Detected :', 'muted')} ${String(summary.detected)}\n`);
    process.stdout.write(`${colorize('Installed:', 'success')} ${String(summary.installed)}\n`);
    process.stdout.write(`${colorize('Removed  :', 'warning')} ${String(summary.removed)}\n`);
    process.stdout.write(`${colorize('Shared files:', 'muted')} ${String(summary.sharedFiles)}\n`);
}

function printMissingRequested(missingRequested: { source: string; skill: string }[]): void {
    if (missingRequested.length === 0) {
        return;
    }

    writeSection(process.stdout, '== Pruned missing (declared but not present upstream) ==', 'warning');
    missingRequested.forEach((entry) => {
        writeBullet(process.stdout, `${entry.source}: "${entry.skill}"`, 'warning');
    });
}

function printInstallSummary(installs: SyncInstallResult[]): void {
    writeSection(process.stdout, '== Install summary ==', 'heading');

    const ok = installs.filter(item => item.ok);
    const failed = installs.filter(item => !item.ok);

    process.stdout.write(`${colorize('OK  :', 'success')} ${String(ok.length)}/${String(installs.length)}\n`);
    process.stdout.write(`${colorize('FAIL:', failed.length > 0 ? 'error' : 'muted')} ${String(failed.length)}/${String(installs.length)}\n`);
    failed.forEach((item) => {
        writeBullet(process.stdout, `${item.source} exit=${String(item.status ?? 1)}`, 'error');
        if (item.cmd?.length) {
            process.stdout.write(`    ${colorize(`cmd: ${item.cmd.join(' ')}`, 'muted')}\n`);
        }
    });
}

function printLockOutcome(lockWritten: boolean, lockRelativePath: string, lockMode?: 'locked' | 'updated'): void {
    if (!lockWritten) {
        if (lockMode === 'locked') {
            writeSection(process.stdout, 'Lock unchanged (locked sync used the existing state).', 'muted');
            return;
        }
        writeSection(process.stdout, 'Lock NOT updated (because installs failed or missing skills were pruned).', 'warning');
        return;
    }

    writeSection(process.stdout, `Lock updated: ${lockRelativePath}`, 'success');
}

function describeConflictReason(reason: string): string {
    switch (reason) {
        case 'modified-managed':
            return 'locally modified managed file';
        case 'missing-baseline-hash':
            return 'managed path has no hash baseline in lock';
        case 'unmanaged-existing-path':
            return 'existing unmanaged path would be overwritten';
        default:
            return reason;
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled result: ${formatUnknown(value)}`);
}
