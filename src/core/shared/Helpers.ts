import type { ErrorWithDetails } from './errors';

export type { ErrorWithDetails } from './errors';

export default class Helpers {
    public static error(message: unknown, details: unknown = null): ErrorWithDetails {
        const error: ErrorWithDetails = new Error(String(message));
        if (details !== null && typeof details !== 'undefined') {
            error.details = details;
        }
        return error;
    }

    public static die(message: unknown, details: unknown = null): never {
        throw Helpers.error(message, details);
    }

    public static uniq<T>(arr: T[]): T[] {
        return [...new Set(arr)];
    }

    public static sortUniq(arr: string[]): string[] {
        return Helpers.uniq(arr).sort((a, b) => a.localeCompare(b));
    }
}
