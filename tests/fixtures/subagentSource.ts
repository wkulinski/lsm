import fs from 'node:fs';
import path from 'node:path';

import GitRunner from '../../src/core/git/GitRunner';

export const subagentSourceFiles = {
    skill: '.agents/skills/example/SKILL.md',
    subagent: '.opencode/agent/reviewer.md',
    sidecar: '.opencode/agent/reviewer.md.lsm.yaml',
    sharedReference: '.agents/skills/_shared/references/runtime-quality-procedures.md',
    sharedScript: '.agents/skills/_shared/scripts/context-manifest.mjs',
} as const;

export function createSubagentSourceRepository(sourceDir: string): string {
    const files: { [key: string]: string } = {
        [subagentSourceFiles.skill]: [
            '---',
            'name: Example',
            'description: Example skill',
            'shared_files:',
            '  - _shared/references/runtime-quality-procedures.md',
            '---',
            '',
            '# Example',
            '',
        ].join('\n'),
        [subagentSourceFiles.subagent]: [
            '---',
            'name: reviewer',
            'description: Reviews changes',
            '---',
            '',
            '# Reviewer',
            '',
        ].join('\n'),
        [subagentSourceFiles.sidecar]: [
            'schema_version: 1',
            'shared_files:',
            '  - .agents/skills/_shared/references/runtime-quality-procedures.md',
            '  - .agents/skills/_shared/scripts/context-manifest.mjs',
            '',
        ].join('\n'),
        [subagentSourceFiles.sharedReference]: '# Runtime quality procedures\n',
        [subagentSourceFiles.sharedScript]: 'export const contextManifest = true;\n',
    };

    Object.entries(files).forEach(([relativePath, content]) => {
        const filePath = path.join(sourceDir, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
    });

    const runner = new GitRunner();
    if (!runner.run(null, ['init', sourceDir]).ok) {
        throw new Error('Unable to initialize subagent source fixture repository.');
    }
    if (!runner.run(sourceDir, ['config', 'user.email', 'test@example.com']).ok) {
        throw new Error('Unable to configure subagent source fixture email.');
    }
    if (!runner.run(sourceDir, ['config', 'user.name', 'Test User']).ok) {
        throw new Error('Unable to configure subagent source fixture name.');
    }
    if (!runner.run(sourceDir, ['add', '.']).ok) {
        throw new Error('Unable to stage subagent source fixture.');
    }
    const commit = runner.run(sourceDir, ['commit', '-m', 'initial subagent fixture']);
    if (!commit.ok) {
        throw new Error('Unable to commit subagent source fixture.');
    }

    return sourceDir;
}
