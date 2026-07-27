import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import ManifestNormalizer from '../src/core/manifest/ManifestNormalizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Etap 5 publish, CLI i dokumentacja', () => {
    test('README manifest example is accepted by the manifest parser', () => {
        const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
        const match = /### Subagenty OpenCode[\s\S]*?```json\n([\s\S]*?)\n```/.exec(readme);
        expect(match?.[1]).toBeTruthy();

        const manifest = JSON.parse(match?.[1] ?? '{}') as unknown;
        expect(new ManifestNormalizer({ manifestFileName: 'skills.json' }).normalize(manifest)).toMatchObject({
            agents: ['codex'],
            subagents: ['opencode'],
            sources: [{
                skills: ['code-implement'],
                subagents: ['researcher', 'reviewer'],
            }],
        });
    });

    test('documentation states the implemented sync-only publish boundary', () => {
        const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
        const coreDocs = fs.readFileSync(path.join(root, 'docs/modules/core/README.md'), 'utf8');

        for (const document of [readme, coreDocs]) {
            expect(document).toContain('subagents');
            expect(document).toContain('sync --update');
            expect(document).toContain('Lock v5');
            expect(document).toContain('Publish currently supports skills only; subagents are sync-only.');
        }
        expect(readme).toContain('.opencode/agent/');
        expect(readme).toContain('.opencode/agents/');
        expect(readme).toContain('schema_version: 1');
        expect(coreDocs).toContain('shared_files');
    });
});
