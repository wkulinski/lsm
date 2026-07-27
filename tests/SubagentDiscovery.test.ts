import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import SubagentDiscovery from '../src/core/source/SubagentDiscovery';
import type { SourceWorkspaceHandle } from '../src/core/source/SourceWorkspace';
import { createTempDir } from './helpers';

describe('SubagentDiscovery', () => {
    test('discovers both OpenCode directory variants and maps nested names deterministically', () => {
        const sourceRoot = createTempDir();
        const projectRoot = createTempDir();

        try {
            writeFile(sourceRoot, '.opencode/agent/team/reviewer.md', '# Reviewer\n');
            writeFile(sourceRoot, '.opencode/agents/researcher.md', [
                '---',
                'name: Researcher',
                'description: Researches changes',
                '---',
                '',
                '# Researcher',
                '',
            ].join('\n'));
            fs.mkdirSync(path.join(projectRoot, '.opencode', 'agent'), { recursive: true });
            fs.mkdirSync(path.join(projectRoot, '.opencode', 'agents'), { recursive: true });

            const result = new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot });

            expect(result).toMatchObject({
                ok: true,
                subagents: [
                    {
                        name: 'team/reviewer',
                        sourcePath: '.opencode/agent/team/reviewer.md',
                        targetPath: '.opencode/agent/team/reviewer.md',
                        description: null,
                    },
                    {
                        name: 'Researcher',
                        sourcePath: '.opencode/agents/researcher.md',
                        targetPath: '.opencode/agents/researcher.md',
                        description: 'Researches changes',
                    },
                ],
            });
            expect(result.ok && result.subagents[0]?.hash.sha256).toMatch(/^[a-f0-9]{64}$/);
        }
        finally {
            remove(sourceRoot, projectRoot);
        }
    });

    test('supports explicit selection and rejects missing names atomically', () => {
        const sourceRoot = createTempDir();
        const projectRoot = createTempDir();

        try {
            writeFile(sourceRoot, '.opencode/agents/reviewer.md', '# Reviewer\n');
            writeFile(sourceRoot, '.opencode/agents/researcher.md', '# Researcher\n');
            const discovery = new SubagentDiscovery();

            const selected = discovery.discoverWorkspace(createWorkspace(sourceRoot), {
                selected: ['researcher'],
                projectRoot,
            });
            expect(selected).toMatchObject({ ok: true, subagents: [{ name: 'researcher' }] });
            expect(() => discovery.discoverWorkspace(createWorkspace(sourceRoot), {
                selected: ['missing'],
                projectRoot,
            })).toThrow('Requested subagent not found: missing');
            expect(discovery.discoverWorkspace(createWorkspace(sourceRoot), {
                selected: [],
                projectRoot,
            })).toMatchObject({ ok: true, subagents: [], sharedFiles: [] });
        }
        finally {
            remove(sourceRoot, projectRoot);
        }
    });

    test('uses locked targetPath without project autodetection', () => {
        const sourceRoot = createTempDir();
        const projectRoot = createTempDir();

        try {
            writeFile(sourceRoot, '.opencode/agent/reviewer.md', '# Reviewer\n');
            fs.mkdirSync(path.join(projectRoot, '.opencode', 'agents'), { recursive: true });
            const result = new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), {
                mode: 'locked',
                projectRoot,
                lockedEntries: [{
                    name: 'reviewer',
                    sourcePath: '.opencode/agent/reviewer.md',
                    targetPath: '.opencode/agent/old-target.md',
                    sharedFiles: [],
                    hash: { sha256: 'baseline', executable: false },
                }],
            });

            expect(result).toMatchObject({
                ok: true,
                subagents: [{ targetPath: '.opencode/agent/old-target.md' }],
            });
        }
        finally {
            remove(sourceRoot, projectRoot);
        }
    });

    test('rejects duplicate names and target paths', () => {
        const sourceRoot = createTempDir();
        const projectRoot = createTempDir();

        try {
            writeFile(sourceRoot, '.opencode/agent/reviewer.md', [
                '---',
                'name: first',
                '---',
                '',
            ].join('\n'));
            writeFile(sourceRoot, '.opencode/agents/reviewer.md', [
                '---',
                'name: second',
                '---',
                '',
            ].join('\n'));
            expect(() => new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot }))
                .toThrow('Duplicate subagent target path');

            writeFile(sourceRoot, '.opencode/agents/duplicate.md', [
                '---',
                'name: first',
                '---',
                '',
            ].join('\n'));
            expect(() => new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot }))
                .toThrow('Duplicate subagent name: first');
        }
        finally {
            remove(sourceRoot, projectRoot);
        }
    });

    test('validates sidecars and rejects traversal or symlinked shared files', () => {
        const sourceRoot = createTempDir();
        const projectRoot = createTempDir();

        try {
            writeFile(sourceRoot, '.opencode/agents/reviewer.md', '# Reviewer\n');
            writeFile(sourceRoot, '.opencode/agents/reviewer.md.lsm.yaml', [
                'schema_version: 2',
                'shared_files: []',
                '',
            ].join('\n'));
            expect(() => new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot }))
                .toThrow('schema_version must be 1');

            writeFile(sourceRoot, '.opencode/agents/reviewer.md.lsm.yaml', [
                'schema_version: 1',
                'shared_files:',
                '  - .agents/skills/_shared/ok.md',
                'extra: true',
                '',
            ].join('\n'));
            writeFile(sourceRoot, '.agents/skills/_shared/ok.md', 'ok\n');
            expect(() => new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot }))
                .toThrow('unknown field "extra"');

            writeFile(sourceRoot, '.opencode/agents/reviewer.md.lsm.yaml', [
                'schema_version: 1',
                'shared_files:',
                '  - .agents/skills/_shared/../outside.md',
                '',
            ].join('\n'));
            expect(() => new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot }))
                .toThrow('must stay inside .agents/skills/_shared');

            writeFile(sourceRoot, '.agents/skills/_shared/outside.md', 'outside\n');
            fs.symlinkSync(path.join(sourceRoot, '.agents/skills/_shared/outside.md'), path.join(sourceRoot, '.agents/skills/_shared/link.md'));
            writeFile(sourceRoot, '.opencode/agents/reviewer.md.lsm.yaml', [
                'schema_version: 1',
                'shared_files:',
                '  - .agents/skills/_shared/link.md',
                '',
            ].join('\n'));
            expect(() => new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot }))
                .toThrow('outside the source root or contains a symbolic link');

            fs.rmSync(path.join(sourceRoot, '.opencode/agents/reviewer.md.lsm.yaml'));
            fs.symlinkSync(
                path.join(sourceRoot, 'missing-sidecar.yaml'),
                path.join(sourceRoot, '.opencode/agents/reviewer.md.lsm.yaml'),
            );
            expect(() => new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot }))
                .toThrow('Subagent sidecar contains a symbolic link');
        }
        finally {
            remove(sourceRoot, projectRoot);
        }
    });

    test('collects executable metadata and rejects symlinked OpenCode directories', () => {
        const sourceRoot = createTempDir();
        const projectRoot = createTempDir();
        const externalRoot = createTempDir();

        try {
            writeFile(sourceRoot, '.opencode/agents/executable.md', '# Executable\n');
            fs.chmodSync(path.join(sourceRoot, '.opencode/agents/executable.md'), 0o755);
            const result = new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot });
            expect(result).toMatchObject({
                ok: true,
                subagents: [{ name: 'executable', hash: { executable: true } }],
            });

            fs.rmSync(path.join(sourceRoot, '.opencode/agents'), { recursive: true, force: true });
            fs.mkdirSync(path.join(externalRoot, 'agents'), { recursive: true });
            writeFile(externalRoot, 'agents/external.md', '# External\n');
            fs.symlinkSync(path.join(externalRoot, 'agents'), path.join(sourceRoot, '.opencode/agents'));
            expect(() => new SubagentDiscovery().discoverWorkspace(createWorkspace(sourceRoot), { projectRoot }))
                .toThrow('Subagent directory contains a symbolic link');
        }
        finally {
            remove(sourceRoot, projectRoot, externalRoot);
        }
    });
});

function createWorkspace(root: string): SourceWorkspaceHandle {
    return {
        source: 'owner/repo',
        root,
        resolved: {
            ok: true,
            handler: 'github',
            provider: 'github',
            url: 'https://github.com/owner/repo.git',
            ref: null,
            subpath: null,
            webUrl: 'https://github.com/owner/repo',
        },
        defaultBranch: 'main',
        resolvedCommit: 'abc123',
        currentBranch: 'main',
    };
}

function writeFile(root: string, relativePath: string, content: string): void {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function remove(...directories: string[]): void {
    directories.forEach((directory) => {
        fs.rmSync(directory, { recursive: true, force: true });
    });
}
