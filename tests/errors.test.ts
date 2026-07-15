import { describe, expect, test } from 'vitest';

import { normalizeError } from '../src/core/shared/errors';

describe('shared errors', () => {
    test('normalizes errors and preserves attached details', () => {
        const error = new Error('failed') as Error & { details?: unknown };
        error.details = { status: 1 };

        expect(normalizeError(error)).toEqual({
            error: 'failed',
            details: { status: 1 },
        });
    });

    test('normalizes non-error values', () => {
        expect(normalizeError('failed')).toEqual({ error: 'failed' });
    });
});
