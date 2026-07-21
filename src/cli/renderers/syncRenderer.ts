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

export function renderSyncEvent(event: ManagerEvent): void {
    switch (event.type) {
        case 'header':
            printHeader(event.header);
            return;
        case 'sync-discover-start':
            process.stdout.write('\n-- Discovering skills (prune-missing enabled) --\n');
            return;
        case 'sync-plan':
            printSyncPlan(event.plan);
            return;
        case 'sync-preflight':
            printPreflight(event.preflight, event.force);
            return;
        case 'sync-add-start':
            process.stdout.write('\n-- Installing desired skills to whitelisted agents --\n');
            return;
        case 'sync-add-source':
            process.stdout.write(`\n>>> Source: ${event.source}\n`);
            process.stdout.write(`    Mode  : ${event.mode}\n`);
            process.stdout.write(`    Skills: ${String(event.skillCount)}\n`);
            return;
        case 'sync-shared-start':
            process.stdout.write('\n-- Syncing shared files declared in skill frontmatter --\n');
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
            process.stdout.write('Sync cancelled.\n');
            return result.exitCode;
        case 'add-failed':
            printInstallSummary(result.installs);
            process.stdout.write('\nAborting before removals because installs failed.\n');
            return result.exitCode;
        case 'shared-failed':
            printSharedErrors(result.shared.errors);
            process.stdout.write('\nAborting before removals because shared file sync failed.\n');
            return result.exitCode;
        case 'completed':
            printSharedSummary(result);
            printMissingRequested(result.missingRequested);
            printInstallSummary(result.installs);
            printLockOutcome(result.lockWritten, result.header.lockRelativePath, result.lockMode);
            return result.exitCode;
    }

    return assertNever(result);
}

function printHeader(header: ManagerHeader): void {
    process.stdout.write('== Skills sync ==\n');
    process.stdout.write(`CLI     : ${header.cliVersion}\n`);
    process.stdout.write(`Manifest: ${header.manifestRelativePath}\n`);
    process.stdout.write(`Lock    : ${header.lockRelativePath}\n`);
    process.stdout.write(`Agents  : ${header.agents.join(', ')}\n`);
}

function printCreatedTemplates(result: ManagerTemplatesCreatedResult): void {
    process.stdout.write('\nBrak wymaganych plików. Utworzono szablony:\n');
    result.createdTemplates.forEach(filePath => process.stdout.write(`  - ${filePath}\n`));
    process.stdout.write('Uzupełnij skills.json i uruchom ponownie.\n');
}

function printSyncPlan(plan: SyncPlan): void {
    process.stdout.write('\n-- Plan --\n');
    process.stdout.write(`Managed(old): ${String(plan.oldManaged.length)}\n`);
    process.stdout.write(`Managed(new): ${String(plan.newManaged.length)}\n`);
    process.stdout.write(`Skills to remove (prune): ${String(plan.skillsRemoved.length)}\n`);
    process.stdout.write(`Agents removed from whitelist: ${String(plan.agentsRemoved.length)}\n`);
}

function printPreflight(preflight: SyncPreflight, force: boolean): void {
    process.stdout.write('\n-- Local change guard --\n');
    process.stdout.write(`Detected potential overwrite/delete conflicts: ${String(preflight.conflicts.length)}\n`);
    preflight.conflicts.forEach((conflict) => {
        const operation = conflict.operation === 'delete' ? 'delete' : 'overwrite';
        process.stdout.write(`  - [${operation}] ${conflict.path} (${describeConflictReason(conflict.reason)})\n`);
    });

    if (force) {
        process.stdout.write('Continuing because --force was provided.\n');
    }
}

function printRemovalStart(plan: SyncPlan): void {
    if (plan.agentsRemoved.length > 0 && plan.oldManaged.length > 0) {
        process.stdout.write(`\n-- Removing managed skills from removed agents: ${plan.agentsRemoved.join(', ')} --\n`);
    }

    if (plan.skillsRemoved.length > 0 && plan.agentsUnion.length > 0) {
        process.stdout.write(`\n-- Pruning removed/missing skills from agents: ${plan.agentsUnion.join(', ')} --\n`);
        return;
    }

    process.stdout.write('\n-- Nothing to prune --\n');
}

function printSharedSummary(result: Extract<SyncCommandResult, { status: 'completed' }>): void {
    const sourcesWithSharedFiles = Object.entries(result.shared.sharedStats)
        .filter(([, stats]) => stats.declaredFiles > 0)
        .map(([source]) => source);

    process.stdout.write('\n== Shared files summary ==\n');
    if (sourcesWithSharedFiles.length === 0) {
        process.stdout.write('No shared files declared.\n');
        return;
    }

    sourcesWithSharedFiles.forEach((source) => {
        const stats = result.shared.sharedStats[source] ?? { declaredFiles: 0, copiedFiles: 0 };
        const managedCount = (result.shared.managedNewLocalPaths[source] ?? []).length;
        process.stdout.write(`- ${source}\n`);
        process.stdout.write(`  declared files: ${String(stats.declaredFiles)}\n`);
        process.stdout.write(`  copied files  : ${String(stats.copiedFiles)}\n`);
        process.stdout.write(`  managed files: ${String(managedCount)}\n`);
    });
    process.stdout.write(`Pruned shared files: ${String(result.shared.removedFiles ?? 0)}\n`);
}

function printSharedErrors(errors: SharedSyncError[]): void {
    errors.forEach((error) => {
        if (error.source) {
            process.stderr.write(`\n${error.message} ${error.source}\n`);
        }
        else {
            process.stderr.write(`\n${error.message}\n`);
        }

        if (Array.isArray(error.details)) {
            error.details.forEach((entry) => {
                if (isObject(entry) && typeof entry.filePath === 'string' && typeof entry.a === 'string' && typeof entry.b === 'string') {
                    process.stderr.write(`   - "${entry.filePath}" in: ${entry.a} AND ${entry.b}\n`);
                    return;
                }
                process.stderr.write(`   - ${formatUnknown(entry)}\n`);
            });
            return;
        }

        if (error.details) {
            process.stderr.write(`   ${formatUnknown(error.details)}\n`);
        }
    });
}

function printMissingRequested(missingRequested: { source: string; skill: string }[]): void {
    if (missingRequested.length === 0) {
        return;
    }

    process.stdout.write('\n== Pruned missing (declared but not present upstream) ==\n');
    missingRequested.forEach((entry) => {
        process.stdout.write(`  - ${entry.source}: "${entry.skill}"\n`);
    });
}

function printInstallSummary(installs: SyncInstallResult[]): void {
    process.stdout.write('\n== Install summary ==\n');

    const ok = installs.filter(item => item.ok);
    const failed = installs.filter(item => !item.ok);

    process.stdout.write(`OK  : ${String(ok.length)}/${String(installs.length)}\n`);
    process.stdout.write(`FAIL: ${String(failed.length)}/${String(installs.length)}\n`);
    failed.forEach((item) => {
        process.stdout.write(`  - ${item.source} exit=${String(item.status ?? 1)}\n`);
        if (item.cmd?.length) {
            process.stdout.write(`    cmd: ${item.cmd.join(' ')}\n`);
        }
    });
}

function printLockOutcome(lockWritten: boolean, lockRelativePath: string, lockMode?: 'locked' | 'updated'): void {
    if (!lockWritten) {
        if (lockMode === 'locked') {
            process.stdout.write('\nLock unchanged (locked sync used the existing state).\n');
            return;
        }
        process.stdout.write('\nLock NOT updated (because installs failed or missing skills were pruned).\n');
        return;
    }

    process.stdout.write(`\nLock updated: ${lockRelativePath}\n`);
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
