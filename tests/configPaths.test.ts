import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { resolveLockPath, resolveManifestPath } from '../src/core/manager/configPaths';

describe('config paths', () => {
    test('resolves default manifest and lock paths below the project root', () => {
        const root = '/tmp/lsm-project';

        expect(resolveManifestPath(root)).toBe(path.join(root, 'skills.json'));
        expect(resolveLockPath(root)).toBe(path.join(root, 'skills.lock.json'));
    });

    test('resolves relative candidates from the project root and keeps absolute paths', () => {
        const root = '/tmp/lsm-project';

        expect(resolveManifestPath(root, 'config/skills.json')).toBe(path.join(root, 'config/skills.json'));
        expect(resolveLockPath(root, '/etc/lsm.lock.json')).toBe('/etc/lsm.lock.json');
    });
});
