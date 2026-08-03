import { formatUnknown } from '../../core/utils/formatUnknown';
import type { ManagerErrorResult } from '../../core/types';
import { colorize, writeBullet } from './terminalFormatter';

export function printError(result: ManagerErrorResult, label = 'Error'): void {
    process.stderr.write(`\n${colorize(`${label}:`, 'error', process.stderr)} ${result.error}\n`);
    if (result.details !== void 0) {
        printErrorDetails(result.details);
    }
}

export function printErrorDetails(details: unknown): void {
    if (typeof details === 'string' && details.trim()) {
        process.stderr.write(`${colorize(details.trim(), 'muted', process.stderr)}\n`);
        return;
    }

    if (Array.isArray(details)) {
        details.forEach((entry) => {
            if (isObject(entry) && typeof entry.skill === 'string' && typeof entry.a === 'string' && typeof entry.b === 'string') {
                writeBullet(process.stderr, `"${entry.skill}" in: ${entry.a} AND ${entry.b}`, 'muted', '   ');
                return;
            }
            writeBullet(process.stderr, formatUnknown(entry), 'muted', '   ');
        });
        return;
    }

    if (isObject(details) && typeof details.status === 'number') {
        process.stderr.write(`   ${colorize(`exit=${String(details.status)}`, 'muted', process.stderr)}\n`);
        if (Array.isArray(details.cmd)) {
            process.stderr.write(`   ${colorize(`cmd: ${details.cmd.join(' ')}`, 'muted', process.stderr)}\n`);
        }
        return;
    }

    process.stderr.write(`${colorize(formatUnknown(details), 'muted', process.stderr)}\n`);
}

export function isObject(value: unknown): value is { [key: string]: unknown } {
    return typeof value === 'object' && value !== null;
}
