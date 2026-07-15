import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import SkillDiscovery from '../src/core/source/SkillDiscovery';
import { createLocalCloneDiscovery, createTempDir, writeSkillMd } from './helpers';

describe('SkillDiscovery', () => {
    test('discovers local skills through the SkillDiscovery facade', () => {
        const tempDir = createTempDir();

        try {
            const skillsRoot = path.join(tempDir, '.agents', 'skills');
            const skillDir = path.join(skillsRoot, 'facade-skill');
            writeSkillMd(skillDir, [
                '---',
                'name: Facade Skill',
                'description: Facade description',
                '---',
                '',
                '# Facade',
            ].join('\n'));

            const discovery = new SkillDiscovery();

            const result = discovery.discover(tempDir, null);

            expect(result.skills).toMatchObject([{
                name: 'Facade Skill',
                description: 'Facade description',
                path: skillDir,
                sharedFiles: [],
            }]);
            expect(result.aliasMap.get('facade skill')).toBe('Facade Skill');
            expect(result.aliasMap.get('facade-skill')).toBe('Facade Skill');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('collects shared files from a cloned source and rejects invalid paths', () => {
        const tempDir = createTempDir();

        try {
            fs.mkdirSync(path.join(tempDir, 'shared'), { recursive: true });
            fs.writeFileSync(path.join(tempDir, 'shared', 'alpha.md'), '# Alpha\n', 'utf8');
            fs.writeFileSync(path.join(tempDir, 'shared', 'beta.md'), '# Beta\n', 'utf8');
            const discovery = createLocalCloneDiscovery(tempDir);

            const result = discovery.collectSharedFiles('owner/repo', [
                ' shared/beta.md ',
                'shared/alpha.md',
                'shared/alpha.md',
            ]);

            expect(result).toMatchObject({
                ok: true,
                files: [
                    { path: 'shared/alpha.md' },
                    { path: 'shared/beta.md' },
                ],
            });
            if (!result.ok) {
                return;
            }
            expect(result.files.map(file => file.content.toString('utf8'))).toEqual([
                '# Alpha\n',
                '# Beta\n',
            ]);
            expect(discovery.collectSharedFiles('owner/repo', ['shared/missing.md'])).toEqual({
                ok: false,
                error: 'Shared file does not exist in source: shared/missing.md',
            });
            expect(() => discovery.collectSharedFiles('owner/repo', ['../outside.md'])).toThrow('"sharedFiles" cannot contain ".."');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('collects skill directories recursively without following symlinks', () => {
        const tempDir = createTempDir();

        try {
            const skillDir = path.join(tempDir, 'skills', 'example');
            const externalDir = path.join(tempDir, 'external');
            writeSkillMd(skillDir, [
                '---',
                'name: Example Skill',
                'description: Example description',
                '---',
                '',
                '# Example',
            ].join('\n'));
            fs.mkdirSync(path.join(skillDir, 'nested'), { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'nested', 'config.json'), '{"enabled":true}\n', 'utf8');
            fs.mkdirSync(externalDir, { recursive: true });
            fs.writeFileSync(path.join(externalDir, 'secret.txt'), 'external\n', 'utf8');
            fs.symlinkSync(path.join(externalDir, 'secret.txt'), path.join(skillDir, 'linked-secret.txt'));
            const discovery = createLocalCloneDiscovery(tempDir);

            const result = discovery.collectSkillDirectories('owner/repo', ['skills/example']);

            expect(result).toMatchObject({
                ok: true,
                directories: [{
                    sourcePath: 'skills/example',
                }],
            });
            if (!result.ok) {
                return;
            }
            expect(result.directories[0]?.files.map(file => file.path)).toEqual([
                'nested/config.json',
                'SKILL.md',
            ]);
            expect(result.directories[0]?.files.map(file => file.content.toString('utf8'))).toEqual([
                '{"enabled":true}\n',
                [
                    '---',
                    'name: Example Skill',
                    'description: Example description',
                    '---',
                    '',
                    '# Example',
                    '',
                ].join('\n'),
            ]);
            expect(discovery.collectSkillDirectories('owner/repo', ['skills/missing'])).toEqual({
                ok: false,
                error: 'Skill path does not exist in source: skills/missing',
            });
            expect(() => discovery.collectSkillDirectories('owner/repo', ['../outside'])).toThrow('"skillSourcePaths" cannot contain ".."');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('lists skills with catalog entries, shared file hashes and resolved git metadata', () => {
        const tempDir = createTempDir();

        try {
            const skillsRoot = path.join(tempDir, '.agents', 'skills');
            const skillDir = path.join(skillsRoot, 'catalog-skill');
            const sharedDir = path.join(skillsRoot, 'shared');
            fs.mkdirSync(sharedDir, { recursive: true });
            fs.writeFileSync(path.join(sharedDir, 'alpha.md'), '# Alpha\n', 'utf8');
            writeSkillMd(skillDir, [
                '---',
                'name: Catalog Skill',
                'description: Catalog description',
                'shared_files:',
                '  - shared/alpha.md',
                '---',
                '',
                '# Catalog',
            ].join('\n'));
            const discovery = createLocalCloneDiscovery(tempDir);

            const result = discovery.listSkills('owner/repo');

            expect(result).toMatchObject({
                ok: true,
                skills: ['Catalog Skill'],
                skillEntries: [{
                    name: 'Catalog Skill',
                    sourcePath: '.agents/skills/catalog-skill',
                    sharedFiles: ['.agents/skills/shared/alpha.md'],
                }],
                sharedFileHashes: [{
                    path: '.agents/skills/shared/alpha.md',
                }],
                resolved: {
                    requestedRef: null,
                    defaultBranch: 'main',
                    resolvedRef: 'main',
                    resolvedCommit: 'abc123',
                    subpath: null,
                },
            });
            if (!result.ok) {
                return;
            }
            expect(result.skillEntries[0]?.hash?.files.map(file => file.path)).toContain('SKILL.md');
            expect(result.sharedFileHashes[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
            expect(result.aliasMap.get('catalog-skill')).toBe('Catalog Skill');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
