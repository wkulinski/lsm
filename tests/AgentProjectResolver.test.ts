import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import AgentProjectResolver from '../src/core/agents/AgentProjectResolver';
import { createTempDir } from './helpers';

describe('AgentProjectResolver', () => {
    test('resolves configured agent skill directories with trimming, case normalization, and dedupe', () => {
        const tempDir = createTempDir();

        try {
            const resolver = new AgentProjectResolver({ root: tempDir });

            expect(resolver.resolveSkillDirs([' codex ', 'CURSOR', 'claude-code'])).toEqual({
                ok: true,
                dirs: [
                    path.join(tempDir, '.agents', 'skills'),
                    path.join(tempDir, '.claude', 'skills'),
                ],
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects empty agent lists', () => {
        const resolver = new AgentProjectResolver({ root: '/tmp/project' });

        expect(resolver.resolveSkillDirs([])).toEqual({
            ok: false,
            error: 'No agents configured for copy sync.',
        });
    });

    test('rejects wildcard agents', () => {
        const resolver = new AgentProjectResolver({ root: '/tmp/project' });

        expect(resolver.resolveSkillDirs(['*'])).toEqual({
            ok: false,
            error: "Copy sync requires explicit agent names (wildcard '*' is not supported).",
        });
    });

    test('rejects unsupported agents with the original agent name in the error', () => {
        const resolver = new AgentProjectResolver({ root: '/tmp/project' });

        expect(resolver.resolveSkillDirs(['Unknown-Agent'])).toEqual({
            ok: false,
            error: 'Unsupported agent for copy sync: "Unknown-Agent". Add mapping in AgentRegistry.',
        });
    });
});
