import fs from 'node:fs';
import path from 'node:path';

import AgentProjectResolver from '../agents/AgentProjectResolver';
import SkillEntryInstaller from '../skills/SkillEntryInstaller';
import BackendSourceService, { type BackendSourceListSkillsOptions } from '../source/BackendSourceService';
import type { AgentProjectSkillDirsResult, BackendCommandResult, BackendVersionResult } from '../types';
import type {
    CollectSharedFilesSuccess,
    FailureResult,
    ListSkillsSuccess,
    ResolvedSource,
} from '../types/discovery';

interface BackendConstructorOptions {
    root: string;
}

export default class BackendAdapter {
    public root: string;

    public constructor({ root }: BackendConstructorOptions) {
        this.root = root;
    }

    public listSkills(source: string, options: BackendSourceListSkillsOptions = {}): ListSkillsSuccess | FailureResult {
        return new BackendSourceService().listSkills(source, options);
    }

    public resolveSource(source: string): ResolvedSource | FailureResult {
        return new BackendSourceService().resolveSource(source);
    }

    public collectSharedFiles(source: string, sharedFiles: string[], options: { resolvedCommit?: string | null } = {}): CollectSharedFilesSuccess | FailureResult {
        return new BackendSourceService().collectSharedFiles(source, sharedFiles, options);
    }

    public installSkillEntries({ source, skillEntries, agents, resolvedCommit = null }: { source: string; skillEntries: unknown[]; agents: string[]; resolvedCommit?: string | null }): BackendCommandResult {
        return new SkillEntryInstaller({ root: this.root }).install({ source, skillEntries, agents, resolvedCommit });
    }

    public removeSkillEntries({ skillEntries, agents }: { skillEntries: unknown[]; agents: string[] }): BackendCommandResult {
        return new SkillEntryInstaller({ root: this.root }).remove({ skillEntries, agents });
    }

    public resolveAgentProjectSkillDirs(agents: string[]): AgentProjectSkillDirsResult {
        return new AgentProjectResolver({ root: this.root }).resolveSkillDirs(agents);
    }

    public getVersion(): BackendVersionResult {
        const packageJsonPath = path.resolve(this.root, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            return { ok: false, status: 1, stdout: '', stderr: `package.json not found: ${packageJsonPath}` };
        }

        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
            const version = typeof packageJson.version === 'string' ? packageJson.version.trim() : '';
            if (!version) {
                return { ok: false, status: 1, stdout: '', stderr: `Missing "version" in ${packageJsonPath}` };
            }

            return {
                ok: true,
                status: 0,
                stdout: version,
                stderr: '',
            };
        }
        catch (error) {
            return {
                ok: false,
                status: 1,
                stdout: '',
                stderr: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
