import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import SkillFrontmatterParser from '../src/core/source/SkillFrontmatterParser';
import { createTempDir, writeSkillMd } from './helpers';

describe('SkillFrontmatterParser', () => {
    test('parses frontmatter and normalizes shared files', () => {
        const tempDir = createTempDir();

        try {
            const skillsRoot = path.join(tempDir, '.agents', 'skills');
            const skillDir = path.join(skillsRoot, 'example');
            const sharedDir = path.join(skillsRoot, 'shared');
            fs.mkdirSync(sharedDir, { recursive: true });
            fs.writeFileSync(path.join(sharedDir, 'alpha.md'), '# Alpha\n', 'utf8');
            fs.writeFileSync(path.join(sharedDir, 'beta.md'), '# Beta\n', 'utf8');
            writeSkillMd(skillDir, [
                '---',
                'name: Example Skill',
                'description: Example description',
                'shared_files:',
                '  - shared/beta.md',
                '  - shared/alpha.md',
                '  - shared/alpha.md',
                '---',
                '',
                '# Example',
            ].join('\n'));

            const parser = new SkillFrontmatterParser();

            expect(parser.parseSkillMd(skillDir, {
                basePath: tempDir,
                searchPath: skillsRoot,
            })).toEqual({
                name: 'Example Skill',
                description: 'Example description',
                path: skillDir,
                sharedFiles: [
                    '.agents/skills/shared/alpha.md',
                    '.agents/skills/shared/beta.md',
                ],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('filters internal skills and rejects invalid shared_files', () => {
        const tempDir = createTempDir();

        try {
            const skillsRoot = path.join(tempDir, 'skills');
            const skillDir = path.join(skillsRoot, 'internal');
            writeSkillMd(skillDir, [
                '---',
                'name: Internal Skill',
                'description: Internal description',
                'metadata:',
                '  internal: true',
                'shared_files:',
                '  - ../outside.md',
                '---',
                '',
                '# Internal',
            ].join('\n'));

            expect(new SkillFrontmatterParser().parseSkillMd(skillDir, {
                basePath: tempDir,
                searchPath: skillsRoot,
            })).toBeNull();
            expect(() => new SkillFrontmatterParser({ includeInternal: true }).parseSkillMd(skillDir, {
                basePath: tempDir,
                searchPath: skillsRoot,
            })).toThrow('shared_files[0]');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects shared files reached through symlinks', () => {
        const tempDir = createTempDir();

        try {
            const skillsRoot = path.join(tempDir, 'skills');
            const skillDir = path.join(skillsRoot, 'example');
            const outsideFile = path.join(tempDir, 'outside.md');
            const sharedDir = path.join(skillsRoot, 'shared');
            fs.mkdirSync(sharedDir, { recursive: true });
            fs.writeFileSync(outsideFile, '# Outside\n', 'utf8');
            fs.symlinkSync(outsideFile, path.join(sharedDir, 'outside.md'));
            writeSkillMd(skillDir, [
                '---',
                'name: Example Skill',
                'description: Example description',
                'shared_files:',
                '  - shared/outside.md',
                '---',
            ].join('\n'));

            expect(() => new SkillFrontmatterParser().parseSkillMd(skillDir, {
                basePath: tempDir,
                searchPath: skillsRoot,
            })).toThrow('contains a symbolic link');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('ignores skill definitions whose SKILL.md is a symlink', () => {
        const tempDir = createTempDir();

        try {
            const skillsRoot = path.join(tempDir, 'skills');
            const skillDir = path.join(skillsRoot, 'example');
            const outsideFile = path.join(tempDir, 'outside.md');
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(outsideFile, '---\nname: Outside\ndescription: Outside\n---\n', 'utf8');
            fs.symlinkSync(outsideFile, path.join(skillDir, 'SKILL.md'));

            expect(new SkillFrontmatterParser().parseSkillMd(skillDir, {
                basePath: tempDir,
                searchPath: skillsRoot,
            })).toBeNull();
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
