import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
    extractSkillsRootPrefix,
    isPathInside,
    normalizePosixPath,
    relativeToSkillsRoot,
    toPosixPath,
} from '../src/core/filesystem/PathUtils';
import { formatUnknown } from '../src/core/utils/formatUnknown';

describe('utils', () => {
    test('formats unknown values for diagnostics', () => {
        const circular: { self?: unknown } = {};
        circular.self = circular;

        expect(formatUnknown('plain')).toBe('plain');
        expect(formatUnknown(42)).toBe('42');
        expect(formatUnknown(null)).toBe('null');
        expect(formatUnknown(void 0)).toBe('undefined');
        expect(formatUnknown(Symbol.for('lsm'))).toBe('Symbol(lsm)');
        expect(formatUnknown(() => true)).toBe('[function]');
        expect(formatUnknown({ ok: true })).toBe('{"ok":true}');
        expect(formatUnknown(circular)).toBe('[unserializable]');
    });

    test('normalizes paths and maps source paths relative to the skills root', () => {
        const root = path.join('tmp', 'project');
        const inside = path.join(root, '.agents', 'skills');
        const outside = path.join(root, '..', 'outside');

        expect(normalizePosixPath('skills\\example\\SKILL.md')).toBe('skills/example/SKILL.md');
        expect(toPosixPath(path.join('skills', 'example'))).toBe('skills/example');
        expect(isPathInside(inside, root)).toBe(true);
        expect(isPathInside(outside, root)).toBe(false);
        expect(extractSkillsRootPrefix('repo\\skills\\group\\skill')).toBe('repo/skills');
        expect(extractSkillsRootPrefix('repo/no-skills-here')).toBeNull();
        expect(relativeToSkillsRoot('repo/skills/group/skill', 'repo/skills')).toBe('group/skill');
        expect(relativeToSkillsRoot('repo/other/group/skill', 'repo/skills')).toBeNull();
    });
});
