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

describe('publish, CLI and documentation contracts', () => {
    test('documented manifest examples are accepted by the manifest parser', () => {
        const normalizer = new ManifestNormalizer({ manifestFileName: 'skills.json' });
        const examples = ['docs/configuration.md', 'docs/usage.md']
            .flatMap(file => manifestExamples(readDoc(file)));

        expect(examples.length).toBeGreaterThanOrEqual(2);
        examples.forEach((example) => {
            expect(() => normalizer.normalize(example)).not.toThrow();
        });

        const mixed = examples.find(example => JSON.stringify(example).includes('"subagents":["opencode"]'));
        expect(normalizer.normalize(mixed)).toMatchObject({
            agents: ['codex'],
            subagents: ['opencode'],
            sources: [{ skills: ['hello-lsm'] }],
        });
    });

    test('the shipped example manifest is accepted by the manifest parser', () => {
        const manifest = JSON.parse(readDoc('examples/skills.json')) as unknown;

        expect(new ManifestNormalizer({ manifestFileName: 'skills.json' }).normalize(manifest)).toMatchObject({
            agents: ['codex'],
            sources: [{ skills: ['hello-lsm'] }],
        });
    });

    test('documentation states the implemented sync-only publish boundary', () => {
        const configuration = readDoc('docs/configuration.md');
        const coreDocs = readDoc('docs/modules/core/README.md');

        for (const document of [configuration, coreDocs]) {
            expect(document).toContain('subagents');
            expect(document).toContain('sync --update');
            expect(document).toContain('Publish currently');
            expect(document).toContain('subagents are sync-only.');
        }
        expect(coreDocs).toContain('Lock v5');
        expect(configuration).toContain('.opencode/agent/');
        expect(configuration).toContain('.opencode/agents/');
        expect(configuration).toContain('schema_version: 1');
        expect(coreDocs).toContain('shared_files');
    });
});
