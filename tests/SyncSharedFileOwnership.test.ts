import { describe, expect, test } from 'vitest';

import SyncSharedFileOwnership from '../src/core/sync/SyncSharedFileOwnership';

describe('SyncSharedFileOwnership', () => {
    test('reports conflicts when different sources manage the same file path', () => {
        const ownership = new SyncSharedFileOwnership();

        expect(ownership.detectOwnershipConflicts({
            upstream: [
                '.agents/skills/shared/a.md',
                '.agents/skills/shared/common.md',
            ],
            fork: [
                '.agents/skills/shared/common.md',
                '.agents/skills/shared/z.md',
            ],
            local: [
                '.agents/skills/shared/a.md',
            ],
        })).toEqual([
            {
                filePath: '.agents/skills/shared/common.md',
                a: 'upstream',
                b: 'fork',
            },
            {
                filePath: '.agents/skills/shared/a.md',
                a: 'upstream',
                b: 'local',
            },
        ]);
    });
});
