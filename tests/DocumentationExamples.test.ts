import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import ManifestNormalizer from '../src/core/manifest/ManifestNormalizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readDoc(relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function manifestExamples(document: string): unknown[] {
    return [...document.matchAll(/^[ \t]*```json\n([\s\S]*?)\n[ \t]*```/gm)]
        .map(match => match[1])
        .filter(block => block.includes('"schemaVersion"') && block.includes('"sources"'))
        .map(block => JSON.parse(block) as unknown);
}

describe('documentation examples', () => {
    test('manifest examples in the configuration reference are accepted by the manifest parser', () => {
        const normalizer = new ManifestNormalizer({ manifestFileName: 'skills.json' });
        const examples = manifestExamples(readDoc('docs/configuration.md'));

        expect(examples.length).toBeGreaterThanOrEqual(1);
        examples.forEach((example) => {
            expect(() => normalizer.normalize(example)).not.toThrow();
        });
    });

    test('the shipped example manifest is accepted by the manifest parser', () => {
        const manifest = JSON.parse(readDoc('examples/skills.json')) as unknown;

        expect(() => new ManifestNormalizer({ manifestFileName: 'skills.json' }).normalize(manifest)).not.toThrow();
    });

    test('the README quick start uses the shipped example manifest', () => {
        const quickStart = /cat > skills\.json <<'EOF'\n([\s\S]*?)\nEOF/.exec(readDoc('README.md'));
        expect(quickStart?.[1]).toBeTruthy();

        expect(JSON.parse(quickStart?.[1] ?? '{}')).toEqual(JSON.parse(readDoc('examples/skills.json')));
    });
});
