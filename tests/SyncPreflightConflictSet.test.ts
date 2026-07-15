import { describe, expect, test } from 'vitest';

import SyncPreflightConflictSet from '../src/core/sync/SyncPreflightConflictSet';

describe('SyncPreflightConflictSet', () => {
    test('deduplicates conflicts by path and reason and returns them sorted by path', () => {
        const conflictSet = new SyncPreflightConflictSet();

        conflictSet.add({
            path: '.agents/skills/z/SKILL.md',
            reason: 'modified-managed',
            operation: 'overwrite',
            scope: 'skill-file',
            source: 'upstream',
            skill: 'Zed',
        });
        conflictSet.add({
            path: '.agents/skills/a/SKILL.md',
            reason: 'modified-managed',
            operation: 'overwrite',
            scope: 'skill-file',
            source: 'upstream',
            skill: 'Alpha',
        });
        conflictSet.add({
            path: '.agents/skills/z/SKILL.md',
            reason: 'modified-managed',
            operation: 'delete',
            scope: 'skill-file',
            source: 'other',
            skill: 'Duplicate',
        });
        conflictSet.add({
            path: ' ',
            reason: 'modified-managed',
        });

        expect(conflictSet.toSortedArray()).toEqual([
            {
                path: '.agents/skills/a/SKILL.md',
                reason: 'modified-managed',
                operation: 'overwrite',
                scope: 'skill-file',
                source: 'upstream',
                skill: 'Alpha',
            },
            {
                path: '.agents/skills/z/SKILL.md',
                reason: 'modified-managed',
                operation: 'overwrite',
                scope: 'skill-file',
                source: 'upstream',
                skill: 'Zed',
            },
        ]);
    });
});
