import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import PluginDiscovery from '../src/core/source/PluginDiscovery';
import type { SourceWorkspaceHandle } from '../src/core/source/SourceWorkspace';
import { createTempDir } from './helpers';

describe('PluginDiscovery', () => {
    test('discovers regular files recursively with stable paths, hashes and executable metadata', () => {
        const sourceRoot = createTempDir();

        try {
            writeFile(sourceRoot, '.opencode/plugins/zeta/plugin.js', 'module.exports = true;\n');
            writeFile(sourceRoot, '.opencode/plugins/alpha/config.json', '{"enabled":true}\n');
            writeFile(sourceRoot, '.opencode/plugins/readme', 'Plugin documentation\n');
            fs.chmodSync(path.join(sourceRoot, '.opencode/plugins/zeta/plugin.js'), 0o755);

            const result = new PluginDiscovery().discoverWorkspace(createWorkspace(sourceRoot));

            expect(result).toMatchObject({
                ok: true,
                plugins: [
                    { sourcePath: '.opencode/plugins/alpha/config.json', targetPath: '.opencode/plugins/alpha/config.json', hash: { executable: false } },
                    { sourcePath: '.opencode/plugins/readme', targetPath: '.opencode/plugins/readme', hash: { executable: false } },
                    { sourcePath: '.opencode/plugins/zeta/plugin.js', targetPath: '.opencode/plugins/zeta/plugin.js', hash: { executable: true } },
                ],
            });
            expect(result.ok && result.plugins[1]?.hash.sha256).toMatch(/^[a-f0-9]{64}$/);
        }
        finally {
            remove(sourceRoot);
        }
    });

    test('returns no plugins when the source directory is missing or empty', () => {
        const sourceRoot = createTempDir();

        try {
            expect(new PluginDiscovery().discoverWorkspace(createWorkspace(sourceRoot))).toEqual({ ok: true, plugins: [] });

            fs.mkdirSync(path.join(sourceRoot, '.opencode/plugins'), { recursive: true });
            expect(new PluginDiscovery().discoverWorkspace(createWorkspace(sourceRoot))).toEqual({ ok: true, plugins: [] });
        }
        finally {
            remove(sourceRoot);
        }
    });

    test('rejects symlinked plugin paths and a source subpath outside the workspace', () => {
        const sourceRoot = createTempDir();

        try {
            writeFile(sourceRoot, '.opencode/plugins/plugin.js', 'plugin\n');
            fs.symlinkSync(path.join(sourceRoot, '.opencode/plugins/plugin.js'), path.join(sourceRoot, '.opencode/plugins/link.js'));
            expect(() => new PluginDiscovery().discoverWorkspace(createWorkspace(sourceRoot)))
                .toThrow('Plugin path contains a symbolic link: .opencode/plugins/link.js');

            expect(() => new PluginDiscovery().discoverWorkspace(createWorkspace(sourceRoot, '../')))
                .toThrow('Plugin source subpath escapes workspace root: ../');
        }
        finally {
            remove(sourceRoot);
        }
    });

    test('rejects a symlinked plugin directory', () => {
        const sourceRoot = createTempDir();
        const externalRoot = createTempDir();

        try {
            fs.mkdirSync(path.join(externalRoot, 'plugins'), { recursive: true });
            fs.mkdirSync(path.join(sourceRoot, '.opencode'), { recursive: true });
            fs.symlinkSync(path.join(externalRoot, 'plugins'), path.join(sourceRoot, '.opencode/plugins'));

            expect(() => new PluginDiscovery().discoverWorkspace(createWorkspace(sourceRoot)))
                .toThrow('Plugin directory contains a symbolic link: .opencode/plugins');
        }
        finally {
            remove(sourceRoot, externalRoot);
        }
    });
});

function createWorkspace(root: string, subpath: string | null = null): SourceWorkspaceHandle {
    return {
        source: 'owner/repo',
        root,
        resolved: {
            ok: true,
            handler: 'github',
            provider: 'github',
            url: 'https://github.com/owner/repo.git',
            ref: null,
            subpath,
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
