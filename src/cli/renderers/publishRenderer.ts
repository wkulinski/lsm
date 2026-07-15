import type { ManagerEvent, ManagerTemplatesCreatedResult, PublishCommandResult } from '../../core/types';
import { isObject, printError } from './errorRenderer';

export function renderPublishEvent(event: ManagerEvent): void {
    if (event.type === 'publish-start') {
        printPublishStart(event.options);
    }
}

export function renderPublishResult(result: PublishCommandResult): number {
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

    return assertNever(result);
}

function printCreatedTemplates(result: ManagerTemplatesCreatedResult): void {
    process.stdout.write('\nBrak wymaganych plików. Utworzono szablony:\n');
    result.createdTemplates.forEach(filePath => process.stdout.write(`  - ${filePath}\n`));
    process.stdout.write('Uzupełnij skills.json i uruchom ponownie.\n');
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

function printPublishResultDetails(result: { [key: string]: unknown }): void {
    const publishSource = typeof result.source === 'string' ? result.source : '';
    process.stdout.write(`\nPublish source : ${publishSource}\n`);
    printOptionalPublishField('Branch', result.branch);
    printOptionalPublishField('PR base', result.baseBranch);
    printOptionalPublishField('Commit', result.commitSha);

    printChangedFiles(result.changedFiles);

    printOptionalPublishField('Compare URL', result.compareUrl);
    if (isObject(result.pr) && typeof result.pr.url === 'string') {
        process.stdout.write(`PR URL         : ${result.pr.url}\n`);
    }

    printPublishList('New skills', result.newSkills);
    printPublishList('Removed skills', result.removeSkills);
    process.stdout.write(`Create PR      : ${result.createPr ? 'yes' : 'no'}\n`);

    printPublishWarnings(result.warnings);
    printPublishMessage(result.message);
}

function printOptionalPublishField(label: string, value: unknown): void {
    if (typeof value === 'string' && value) {
        process.stdout.write(`${label.padEnd(15)}: ${value}\n`);
    }
}

function printChangedFiles(value: unknown): void {
    const changedFiles = Array.isArray(value) ? value : [];
    process.stdout.write(`Changed files  : ${String(changedFiles.length)}\n`);
    changedFiles.forEach((entry) => {
        if (isObject(entry) && typeof entry.status === 'string' && typeof entry.path === 'string') {
            process.stdout.write(`  - [${entry.status}] ${entry.path}\n`);
        }
    });
}

function printPublishList(label: string, value: unknown): void {
    const entries = Array.isArray(value)
        ? value.map(entry => String(entry))
        : [];
    process.stdout.write(`${label.padEnd(15)}: ${entries.length ? entries.join(', ') : '(none)'}\n`);
}

function printPublishWarnings(value: unknown): void {
    if (!Array.isArray(value) || value.length === 0) {
        return;
    }

    process.stdout.write('\nWarnings:\n');
    value.forEach(warning => process.stdout.write(`  - ${String(warning)}\n`));
}

function printPublishMessage(value: unknown): void {
    if (typeof value === 'string' && value) {
        process.stdout.write(`\n${value}\n`);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled result status: ${String(value as unknown)}`);
}
