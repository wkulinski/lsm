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
            plugins: [{
                sourcePath: '.opencode/plugins/plugin.js',
                targetPath: '.opencode/plugins/plugin.js',
                content: Buffer.from('module.exports = true;\n'),
                hash: { sha256: 'ignored', executable: true },
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
            {
                owner: 'upstream',
                sourcePath: '.opencode/plugins/plugin.js',
                targetPath: '.opencode/plugins/plugin.js',
                content: Buffer.from('module.exports = true;\n'),
                executable: true,
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
