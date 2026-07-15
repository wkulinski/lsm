export type ErrorWithDetails = Error & { details?: unknown };

export interface NormalizedError {
    error: string;
    details?: unknown;
}

export function normalizeError(error: unknown): NormalizedError {
    if (error instanceof Error) {
        const details = (error as ErrorWithDetails).details;
        return {
            error: error.message,
            details,
        };
    }

    return {
        error: String(error),
    };
}
