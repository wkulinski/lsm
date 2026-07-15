import { formatUnknown } from '../../core/utils/formatUnknown';
import type { ManagerErrorResult } from '../../core/types';

export function printError(result: ManagerErrorResult, label = 'Error'): void {
    process.stderr.write(`\n${label}: ${result.error}\n`);
    if (result.details !== void 0) {
        printErrorDetails(result.details);
    }
}

export function printErrorDetails(details: unknown): void {
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
        process.stderr.write(`   exit=${String(details.status)}\n`);
        if (Array.isArray(details.cmd)) {
            process.stderr.write(`   cmd: ${details.cmd.join(' ')}\n`);
        }
        return;
    }

    process.stderr.write(`${formatUnknown(details)}\n`);
}

export function isObject(value: unknown): value is { [key: string]: unknown } {
    return typeof value === 'object' && value !== null;
}
