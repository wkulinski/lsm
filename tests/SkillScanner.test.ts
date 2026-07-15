import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import SkillFrontmatterParser from '../src/core/source/SkillFrontmatterParser';
import SkillScanner from '../src/core/source/SkillScanner';
import { createTempDir, writeSkillMd } from './helpers';

describe('SkillScanner', () => {
    test('discovers priority skill directories and maps directory aliases', () => {
        const tempDir = createTempDir();

        try {
            const skillsRoot = path.join(tempDir, '.agents', 'skills');
            const publicSkillDir = path.join(skillsRoot, 'example-dir');
            const internalSkillDir = path.join(skillsRoot, 'internal-dir');
            writeSkillMd(publicSkillDir, [
                '---',
                'name: Public Skill',
                'description: Public description',
                '---',
                '',
                '# Public',
            ].join('\n'));
            writeSkillMd(internalSkillDir, [
                '---',
                'name: Internal Skill',
                'description: Internal description',
                'metadata:',
                '  internal: true',
                '---',
                '',
                '# Internal',
            ].join('\n'));

            const defaultScanner = new SkillScanner();
            const internalScanner = new SkillScanner({
                skillFrontmatterParser: new SkillFrontmatterParser({ includeInternal: true }),
            });

            const defaultResult = defaultScanner.discover(tempDir, null);
            expect(defaultResult.skills.map(skill => skill.name)).toEqual(['Public Skill']);
            expect(defaultResult.aliasMap.get('public skill')).toBe('Public Skill');
            expect(defaultResult.aliasMap.get('example-dir')).toBe('Public Skill');

            const internalResult = internalScanner.discover(tempDir, null);
            expect(internalResult.skills.map(skill => skill.name).toSorted()).toEqual([
                'Internal Skill',
                'Public Skill',
            ]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('does not scan outside the base path when subpath escapes it', () => {
        const tempDir = createTempDir();

        try {
            const basePath = path.join(tempDir, 'clone');
            const outsideSkillDir = path.join(tempDir, 'outside', 'skill');
            fs.mkdirSync(basePath, { recursive: true });
            writeSkillMd(outsideSkillDir, [
                '---',
                'name: Outside Skill',
                'description: Must not be scanned',
                '---',
            ].join('\n'));

            const result = new SkillScanner().discover(basePath, '../outside');

            expect(result.skills).toEqual([]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
