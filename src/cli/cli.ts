import fs from 'node:fs';

import { Command, CommanderError } from 'commander';

import { createManager } from '../core/manager';
import type {
    ManagerErrorResult,
    ManagerEvent,
    ManagerHeader,
    ManagerTemplatesCreatedResult,
    PublishCommandResult,
    SharedSyncError,
    SyncCommandResult,
    SyncConfirmationRequest,
    SyncInstallResult,
    SyncPlan,
    SyncPreflight,
} from '../core/types';

export async function runCli(argv: string[]): Promise<number> {
    let exitCode = 0;

    const program = new Command()
        .name('lsm')
        .description('LLM Skills Manager')
        .showHelpAfterError()
        .exitOverride()
    ;

    program
        .command('sync')
        .description('Synchronize managed skills from manifest sources')
        .option('--manifest <path>', 'Path to skills manifest')
        .option('--force', 'Continue despite local change conflicts')
        .action(async (options: { manifest?: string; force?: boolean }) => {
            exitCode = await runSyncCommand(options);
        })
    ;

    program
        .command('publish')
        .description('Publish local managed skills back to the source repository')
        .option('--manifest <path>', 'Path to skills manifest')
        .option('--source <source>', 'Explicit source from manifest')
        .option('--new-skill <name>', 'Mark skill for publishing as new', collectValues, [])
        .option('--remove-skill <name>', 'Mark skill for removal upstream', collectValues, [])
        .option('--dry-run', 'Plan publish changes without committing')
        .option('--confirm-deletes', 'Allow planned deletes')
        .option('--message <message>', 'Commit message override')
        .option('--branch <name>', 'Publish branch name')
        .option('--no-pr', 'Do not create a pull request')
        .option('--title <title>', 'Pull request title override')
        .option('--body <body>', 'Pull request body override')
        .action(async (options: {
            manifest?: string;
            source?: string;
            newSkill?: string[];
            removeSkill?: string[];
            dryRun?: boolean;
            confirmDeletes?: boolean;
            message?: string;
            branch?: string;
            pr?: boolean;
            title?: string;
            body?: string;
        }) => {
            exitCode = await runPublishCommand(options);
        })
    ;

    try {
        await program.parseAsync(normalizeCliArgv(argv), { from: 'user' });
        return exitCode;
    } catch (error) {
        if (error instanceof CommanderError) {
            return error.code === 'commander.helpDisplayed' ? 0 : error.exitCode;
        }
        throw error;
    }
}

async function runSyncCommand(options: { manifest?: string; force?: boolean }): Promise<number> {
    const manager = createManager({
        cwd: process.cwd(),
        manifestPath: options.manifest,
    });

    const result = await manager.runSync({
        force: options.force === true,
        report: renderManagerEvent,
        confirmLocalChanges: confirmLocalChanges,
    });

    return renderSyncResult(result);
}

async function runPublishCommand(options: {
    manifest?: string;
    source?: string;
    newSkill?: string[];
    removeSkill?: string[];
    dryRun?: boolean;
    confirmDeletes?: boolean;
    message?: string;
    branch?: string;
    pr?: boolean;
    title?: string;
    body?: string;
}): Promise<number> {
    const manager = createManager({
        cwd: process.cwd(),
        manifestPath: options.manifest,
    });

    const result = await manager.runPublish({
        source: options.source,
        newSkills: options.newSkill,
        removeSkills: options.removeSkill,
        dryRun: options.dryRun === true,
        confirmDeletes: options.confirmDeletes === true,
        message: options.message,
        branch: options.branch,
        createPr: options.pr === false ? false : null,
        title: options.title,
        body: options.body,
        report: renderManagerEvent,
    });

    return renderPublishResult(result);
}

function renderManagerEvent(event: ManagerEvent): void {
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
            process.stdout.write(`    Skills: ${event.skillCount}\n`);
            return;
        case 'sync-shared-start':
            process.stdout.write('\n-- Syncing shared files declared in skill frontmatter --\n');
            return;
        case 'sync-remove-start':
            printRemovalStart(event.plan);
            return;
        case 'publish-start':
            printPublishStart(event.options);
            return;
    }
}

async function confirmLocalChanges(_: SyncConfirmationRequest): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('Sync aborted: local change conflicts detected in non-interactive mode.\nRe-run with --force to continue anyway.');
    }

    return askYesNo('Continue sync and overwrite/delete these paths? [y/N] ');
}

function renderSyncResult(result: SyncCommandResult): number {
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
            printLockOutcome(result.lockWritten, result.header.lockRelativePath);
            return result.exitCode;
    }
}

function renderPublishResult(result: PublishCommandResult): number {
    switch (result.status) {
        case 'templates-created':
            printCreatedTemplates(result);
            return result.exitCode;
        case 'error':
            printError(result, 'Publish failed');
            return result.exitCode;
        case 'completed':
            printPublishResultDetails(result.result);
            return result.exitCode;
    }
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
    result.createdTemplates.forEach((filePath) => process.stdout.write(`  - ${filePath}\n`));
    process.stdout.write('Uzupełnij skills.json i uruchom ponownie.\n');
}

function printSyncPlan(plan: SyncPlan): void {
    process.stdout.write('\n-- Plan --\n');
    process.stdout.write(`Managed(old): ${plan.oldManaged.length}\n`);
    process.stdout.write(`Managed(new): ${plan.newManaged.length}\n`);
    process.stdout.write(`Skills to remove (prune): ${plan.skillsRemoved.length}\n`);
    process.stdout.write(`Agents removed from whitelist: ${plan.agentsRemoved.length}\n`);
}

function printPreflight(preflight: SyncPreflight, force: boolean): void {
    process.stdout.write('\n-- Local change guard --\n');
    process.stdout.write(`Detected potential overwrite/delete conflicts: ${preflight.conflicts.length}\n`);
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
        process.stdout.write(`  declared files: ${stats.declaredFiles}\n`);
        process.stdout.write(`  copied files  : ${stats.copiedFiles}\n`);
        process.stdout.write(`  managed files: ${managedCount}\n`);
    });
    process.stdout.write(`Pruned shared files: ${result.shared.removedFiles ?? 0}\n`);
}

function printSharedErrors(errors: SharedSyncError[]): void {
    errors.forEach((error) => {
        if (error.source) {
            process.stderr.write(`\n${error.message} ${error.source}\n`);
        } else {
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

function printMissingRequested(missingRequested: Array<{ source: string; skill: string }>): void {
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

    const ok = installs.filter((item) => item.ok);
    const failed = installs.filter((item) => !item.ok);

    process.stdout.write(`OK  : ${ok.length}/${installs.length}\n`);
    process.stdout.write(`FAIL: ${failed.length}/${installs.length}\n`);
    failed.forEach((item) => {
        process.stdout.write(`  - ${item.source} exit=${item.status ?? 1}\n`);
        if (item.cmd?.length) {
            process.stdout.write(`    cmd: ${item.cmd.join(' ')}\n`);
        }
    });
}

function printLockOutcome(lockWritten: boolean, lockRelativePath: string): void {
    if (!lockWritten) {
        process.stdout.write('\nLock NOT updated (because installs failed or missing skills were pruned).\n');
        return;
    }

    process.stdout.write(`\nLock updated: ${lockRelativePath}\n`);
}

function printPublishStart(options: {
    source: string | null;
    newSkills: string[];
    removeSkills: string[];
    dryRun: boolean;
    confirmDeletes: boolean;
    createPr: boolean | null;
}): void {
    process.stdout.write('\n-- Publishing skills --\n');
    process.stdout.write(`Source     : ${options.source ?? '(auto: single source)'}\n`);
    process.stdout.write(`New skills : ${options.newSkills.length > 0 ? options.newSkills.join(', ') : '(none)'}\n`);
    process.stdout.write(`Remove skills: ${options.removeSkills.length > 0 ? options.removeSkills.join(', ') : '(none)'}\n`);
    process.stdout.write(`Dry-run    : ${options.dryRun ? 'yes' : 'no'}\n`);
    process.stdout.write(`Confirm deletes: ${options.confirmDeletes ? 'yes' : 'no'}\n`);
    process.stdout.write(`Create PR  : ${options.createPr === false ? 'no (forced)' : 'auto from manifest'}\n`);
}

function printPublishResultDetails(result: Record<string, unknown>): void {
    process.stdout.write(`\nPublish source : ${String(result.source ?? '')}\n`);
    if (typeof result.branch === 'string' && result.branch) {
        process.stdout.write(`Branch         : ${result.branch}\n`);
    }
    if (typeof result.baseBranch === 'string' && result.baseBranch) {
        process.stdout.write(`PR base        : ${result.baseBranch}\n`);
    }
    if (typeof result.commitSha === 'string' && result.commitSha) {
        process.stdout.write(`Commit         : ${result.commitSha}\n`);
    }

    const changedFiles = Array.isArray(result.changedFiles) ? result.changedFiles : [];
    process.stdout.write(`Changed files  : ${changedFiles.length}\n`);
    changedFiles.forEach((entry) => {
        if (isObject(entry) && typeof entry.status === 'string' && typeof entry.path === 'string') {
            process.stdout.write(`  - [${entry.status}] ${entry.path}\n`);
        }
    });

    if (typeof result.compareUrl === 'string' && result.compareUrl) {
        process.stdout.write(`Compare URL    : ${result.compareUrl}\n`);
    }
    if (isObject(result.pr) && typeof result.pr.url === 'string') {
        process.stdout.write(`PR URL         : ${result.pr.url}\n`);
    }

    const newSkills = Array.isArray(result.newSkills) ? result.newSkills : [];
    const removeSkills = Array.isArray(result.removeSkills) ? result.removeSkills : [];
    process.stdout.write(`New skills     : ${newSkills.length ? newSkills.join(', ') : '(none)'}\n`);
    process.stdout.write(`Removed skills : ${removeSkills.length ? removeSkills.join(', ') : '(none)'}\n`);
    process.stdout.write(`Create PR      : ${result.createPr ? 'yes' : 'no'}\n`);

    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        process.stdout.write('\nWarnings:\n');
        result.warnings.forEach((warning) => process.stdout.write(`  - ${String(warning)}\n`));
    }
    if (typeof result.message === 'string' && result.message) {
        process.stdout.write(`\n${result.message}\n`);
    }
}

function printError(result: ManagerErrorResult, label = 'Error'): void {
    process.stderr.write(`\n${label}: ${result.error}\n`);
    if (result.details !== undefined) {
        printErrorDetails(result.details);
    }
}

function printErrorDetails(details: unknown): void {
    if (typeof details === 'string' && details.trim()) {
        process.stderr.write(`${details.trim()}\n`);
        return;
    }

    if (Array.isArray(details)) {
        details.forEach((entry) => {
            if (isObject(entry) && typeof entry.skill === 'string' && typeof entry.a === 'string' && typeof entry.b === 'string') {
                process.stderr.write(`   - "${entry.skill}" in: ${entry.a} AND ${entry.b}\n`);
                return;
            }
            process.stderr.write(`   - ${formatUnknown(entry)}\n`);
        });
        return;
    }

    if (isObject(details) && typeof details.status === 'number') {
        process.stderr.write(`   exit=${details.status}\n`);
        if (Array.isArray(details.cmd)) {
            process.stderr.write(`   cmd: ${details.cmd.join(' ')}\n`);
        }
        return;
    }

    process.stderr.write(`${formatUnknown(details)}\n`);
}

function normalizeCliArgv(argv: string[]): string[] {
    if (argv.length === 0 || argv[0]?.startsWith('-')) {
        return ['sync', ...argv];
    }

    return argv;
}

function collectValues(value: string, previous: string[]): string[] {
    return [...previous, value];
}

function askYesNo(question: string): boolean {
    process.stdout.write(question);
    const answerBuffer = Buffer.alloc(128);
    const bytesRead = fs.readSync(process.stdin.fd, answerBuffer, 0, answerBuffer.length, null);
    const answer = answerBuffer.toString('utf8', 0, bytesRead).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
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

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null;
}

function formatUnknown(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value);
}
