import { describe, expect, test } from 'vitest';

import SubagentManagedFileAdapter from '../src/core/subagents/SubagentManagedFileAdapter';

describe('SubagentManagedFileAdapter', () => {
    test('maps agent and sidecar shared files into managed declarations', () => {
        const declarations = new SubagentManagedFileAdapter().declarations({
            source: 'upstream',
            subagents: [{
                name: 'reviewer',
                description: null,
                sourcePath: '.opencode/agent/reviewer.md',
                targetPath: '.opencode/agents/reviewer.md',
                sharedFiles: [],
                content: Buffer.from('# Reviewer\n'),
                hash: { sha256: 'ignored', executable: false },
            }],
            sharedFiles: [{
                path: '.agents/skills/_shared/references/runtime.md',
                content: Buffer.from('# Runtime\n'),
                executable: true,
            }],
        });

        expect(declarations).toEqual([
            {
                owner: 'upstream',
                sourcePath: '.agents/skills/_shared/references/runtime.md',
                targetPath: '.agents/skills/_shared/references/runtime.md',
                content: Buffer.from('# Runtime\n'),
                executable: true,
            },
            {
                owner: 'upstream',
                sourcePath: '.opencode/agent/reviewer.md',
                targetPath: '.opencode/agents/reviewer.md',
                content: Buffer.from('# Reviewer\n'),
                executable: false,
            },
        ]);
    });

    test('rejects shared files outside the fixed shared root', () => {
        expect(() => new SubagentManagedFileAdapter().declarations({
            source: 'upstream',
            subagents: [],
            sharedFiles: [{ path: '.opencode/config.json', content: Buffer.from('{}'), executable: false }],
        })).toThrow('must be inside .agents/skills/_shared');
    });
});
