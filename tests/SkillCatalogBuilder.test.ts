import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import SkillCatalogBuilder from '../src/core/source/SkillCatalogBuilder';
import { createTempDir, writeSkillMd } from './helpers';

describe('SkillCatalogBuilder', () => {
    test('builds sorted skill entries and hashes shared files', () => {
        const tempDir = createTempDir();

        try {
            const alphaDir = path.join(tempDir, 'skills', 'alpha');
            const betaDir = path.join(tempDir, 'skills', 'beta');
            fs.mkdirSync(path.join(tempDir, 'shared'), { recursive: true });
            fs.writeFileSync(path.join(tempDir, 'shared', 'a.md'), '# A\n', 'utf8');
            fs.writeFileSync(path.join(tempDir, 'shared', 'z.md'), '# Z\n', 'utf8');
            writeSkillMd(betaDir, [
                '---',
                'name: Beta',
                'description: Beta description',
                '---',
                '',
                '# Beta',
            ].join('\n'));
            writeSkillMd(alphaDir, [
                '---',
                'name: Alpha',
                'description: Alpha description',
                '---',
                '',
                '# Alpha',
            ].join('\n'));

            const catalog = new SkillCatalogBuilder().build(tempDir, [
                {
                    name: 'Beta',
                    description: 'Beta description',
                    path: betaDir,
                    sharedFiles: ['shared/z.md', 'shared/a.md', 'shared/a.md'],
                },
                {
                    name: 'Alpha',
                    description: 'Alpha description',
                    path: alphaDir,
                    sharedFiles: [],
                },
            ]);

            expect(catalog.skillNames).toEqual(['Alpha', 'Beta']);
            expect(catalog.skillEntries.map(entry => entry.name)).toEqual(['Alpha', 'Beta']);
            expect(catalog.skillEntries.map(entry => entry.sourcePath)).toEqual(['skills/alpha', 'skills/beta']);
            expect(catalog.skillEntries[1]?.sharedFiles).toEqual(['shared/a.md', 'shared/z.md']);
            expect(catalog.skillEntries[0]?.hash?.files.map(file => file.path)).toContain('SKILL.md');
            expect(catalog.sharedFileHashes.map(entry => entry.path)).toEqual(['shared/a.md', 'shared/z.md']);
            expect(catalog.sharedFileHashes.map(entry => entry.sha256)).toEqual([
                expect.stringMatching(/^[a-f0-9]{64}$/),
                expect.stringMatching(/^[a-f0-9]{64}$/),
            ]);
            expect(() => new SkillCatalogBuilder().hashSharedFile(tempDir, '../outside.md')).toThrow('escapes source root');
            expect(() => new SkillCatalogBuilder().hashSharedFile(tempDir, 'shared/missing.md')).toThrow('does not exist');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
