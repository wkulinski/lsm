import type { ManagerEvent, ManagerTemplatesCreatedResult, PublishCommandResult } from '../../core/types';
import { isObject, printError } from './errorRenderer';
import { colorize, writeBullet, writeSection } from './terminalFormatter';

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
    writeSection(process.stdout, 'Brak wymaganych plików. Utworzono szablony:', 'warning');
    result.createdTemplates.forEach((filePath) => {
        writeBullet(process.stdout, filePath);
    });
    process.stdout.write(`${colorize('Uzupełnij skills.json i uruchom ponownie.', 'muted')}\n`);
}

function printPublishStart(options: {
    source: string | null;
    newSkills: string[];
    removeSkills: string[];
    dryRun: boolean;
    confirmDeletes: boolean;
    createPr: boolean | null;
}): void {
    writeSection(process.stdout, '-- Publishing skills --', 'info');
    process.stdout.write(`${colorize('Source     :', 'muted')} ${options.source ?? '(auto: single source)'}\n`);
    process.stdout.write(`${colorize('New skills :', 'muted')} ${options.newSkills.length > 0 ? options.newSkills.join(', ') : '(none)'}\n`);
    process.stdout.write(`${colorize('Remove skills:', 'muted')} ${options.removeSkills.length > 0 ? options.removeSkills.join(', ') : '(none)'}\n`);
    process.stdout.write(`${colorize('Dry-run    :', 'muted')} ${options.dryRun ? 'yes' : 'no'}\n`);
    process.stdout.write(`${colorize('Confirm deletes:', 'muted')} ${options.confirmDeletes ? 'yes' : 'no'}\n`);
    process.stdout.write(`${colorize('Create PR  :', 'muted')} ${options.createPr === false ? 'no (forced)' : 'auto from manifest'}\n`);
}

function printPublishResultDetails(result: { [key: string]: unknown }): void {
    const publishSource = typeof result.source === 'string' ? result.source : '';
    writeSection(process.stdout, `Publish source : ${publishSource}`, 'heading');
    printOptionalPublishField('Branch', result.branch);
    printOptionalPublishField('PR base', result.baseBranch);
    printOptionalPublishField('Commit', result.commitSha);

    printChangedFiles(result.changedFiles);

    printOptionalPublishField('Compare URL', result.compareUrl);
    if (isObject(result.pr) && typeof result.pr.url === 'string') {
        process.stdout.write(`${colorize('PR URL         :', 'success')} ${result.pr.url}\n`);
    }

    printPublishList('New skills', result.newSkills);
    printPublishList('Removed skills', result.removeSkills);
    process.stdout.write(`${colorize('Create PR      :', 'muted')} ${result.createPr ? 'yes' : 'no'}\n`);

    printPublishWarnings(result.warnings);
    printPublishMessage(result.message);
}

function printOptionalPublishField(label: string, value: unknown): void {
    if (typeof value === 'string' && value) {
        process.stdout.write(`${colorize(`${label.padEnd(15)}:`, 'muted')} ${value}\n`);
    }
}

function printChangedFiles(value: unknown): void {
    const changedFiles = Array.isArray(value) ? value : [];
    process.stdout.write(`${colorize('Changed files  :', 'muted')} ${String(changedFiles.length)}\n`);
    changedFiles.forEach((entry) => {
        if (isObject(entry) && typeof entry.status === 'string' && typeof entry.path === 'string') {
            const tone = entry.status === 'D' ? 'warning' : entry.status === 'A' ? 'success' : 'info';
            writeBullet(process.stdout, `${colorize(`[${entry.status}]`, tone)} ${entry.path}`);
        }
    });
}

function printPublishList(label: string, value: unknown): void {
    const entries = Array.isArray(value)
        ? value.map(entry => String(entry))
        : [];
    process.stdout.write(`${colorize(`${label.padEnd(15)}:`, 'muted')} ${entries.length ? entries.join(', ') : '(none)'}\n`);
}

function printPublishWarnings(value: unknown): void {
    if (!Array.isArray(value) || value.length === 0) {
        return;
    }

    writeSection(process.stdout, 'Warnings:', 'warning');
    value.forEach((warning) => {
        writeBullet(process.stdout, String(warning), 'warning');
    });
}

function printPublishMessage(value: unknown): void {
    if (typeof value === 'string' && value) {
        process.stdout.write(`\n${colorize(value, 'success')}\n`);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled result status: ${String(value as unknown)}`);
}
