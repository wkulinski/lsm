import path from 'node:path';

import Helpers from '../shared/Helpers';
import SkillDiscovery from '../source/SkillDiscovery';
import SkillInstaller from './SkillInstaller';
import { extractSkillsRootPrefix, hasSymlinkInPath, isPathInside, relativeToSkillsRoot } from '../filesystem/PathUtils';
import AgentProjectResolver from '../agents/AgentProjectResolver';
import type { AgentProjectSkillDirsResult, BackendCommandResult } from '../types';
import type { SkillDirectoryFile } from '../types/discovery';

type ErrorWithDetails = Error & { details?: unknown };

interface BackendSkillEntry {
    name: string;
    sourcePath: string;
}

interface CollectedSkillDirectoryEntry {
    sourcePath: string;
    files: SkillDirectoryFile[];
}

interface SkillEntryInstallerConstructorOptions {
    root: string;
}

interface InstallSkillEntriesInput {
    source: string;
    skillEntries: unknown[];
    agents: string[];
}

interface RemoveSkillEntriesInput {
    skillEntries: unknown[];
    agents: string[];
}

export default class SkillEntryInstaller {
    private readonly root: string;

    public constructor({ root }: SkillEntryInstallerConstructorOptions) {
        this.root = root;
    }

    public install({ source, skillEntries, agents }: InstallSkillEntriesInput): BackendCommandResult {
        const dirsResult = this.resolveAgentProjectSkillDirs(agents);
        if (!dirsResult.ok) {
            return {
                ok: false,
                status: 1,
                cmd: ['internal-install', source],
                error: dirsResult.error,
            };
        }

        const normalizedEntries = this.normalizeSkillEntries(skillEntries);
        if (normalizedEntries.length === 0) {
            return {
                ok: true,
                status: 0,
                cmd: ['internal-install', source],
            };
        }

        const sourceSkillsRoot = this.resolveSourceSkillsRootPrefix(normalizedEntries);
        if (!sourceSkillsRoot.ok) {
            return {
                ok: false,
                status: 1,
                cmd: ['internal-install', source],
                error: sourceSkillsRoot.error ?? 'Cannot infer source skills root from skill entries.',
            };
        }

        const discovery = new SkillDiscovery();
        const collected = discovery.collectSkillDirectories(
            source,
            normalizedEntries.map(entry => entry.sourcePath),
        );
        if (!collected.ok) {
            return {
                ok: false,
                status: 1,
                cmd: ['internal-install', source],
                error: collected.error,
                details: collected.details,
            };
        }

        try {
            dirsResult.dirs.forEach((agentSkillDir: string) => {
                collected.directories.forEach((directoryEntry: CollectedSkillDirectoryEntry) => {
                    const sourceSkillsRootPrefix = sourceSkillsRoot.prefix ?? '';
                    const relativePath = relativeToSkillsRoot(directoryEntry.sourcePath, sourceSkillsRootPrefix);
                    if (!relativePath) {
                        Helpers.die(`Skill path does not match source skills root (${sourceSkillsRootPrefix}): ${directoryEntry.sourcePath}`);
                    }

                    const destinationPath = path.resolve(agentSkillDir, relativePath);
                    if (!isPathInside(destinationPath, this.root)) {
                        Helpers.die(`Skill destination escapes project root: ${destinationPath}`);
                    }
                    if (!isPathInside(destinationPath, agentSkillDir) || hasSymlinkInPath(destinationPath, this.root)) {
                        Helpers.die(`Skill destination contains a symbolic link or escapes agent skills directory: ${destinationPath}`);
                    }

                    SkillInstaller.writeDirectory(destinationPath, directoryEntry.files);
                });
            });

            return {
                ok: true,
                status: 0,
                cmd: ['internal-install', source],
            };
        }
        catch (error) {
            return this.createFailure(['internal-install', source], error);
        }
    }

    public remove({ skillEntries, agents }: RemoveSkillEntriesInput): BackendCommandResult {
        const dirsResult = this.resolveAgentProjectSkillDirs(agents);
        if (!dirsResult.ok) {
            return {
                ok: false,
                status: 1,
                cmd: ['internal-remove'],
                error: dirsResult.error,
            };
        }

        const normalizedEntries = this.normalizeSkillEntries(skillEntries);
        if (normalizedEntries.length === 0) {
            return {
                ok: true,
                status: 0,
                cmd: ['internal-remove'],
            };
        }

        try {
            dirsResult.dirs.forEach((agentSkillDir: string) => {
                normalizedEntries.forEach((entry) => {
                    const sourceSkillsRoot = extractSkillsRootPrefix(entry.sourcePath);
                    if (!sourceSkillsRoot) {
                        Helpers.die(`Cannot infer source skills root from skill path: ${entry.sourcePath}`);
                    }

                    const relativePath = relativeToSkillsRoot(entry.sourcePath, sourceSkillsRoot);
                    if (!relativePath) {
                        Helpers.die(`Skill path does not match source skills root (${sourceSkillsRoot}): ${entry.sourcePath}`);
                    }

                    const destinationPath = path.resolve(agentSkillDir, relativePath);
                    if (!isPathInside(destinationPath, this.root)) {
                        Helpers.die(`Managed skill destination escapes project root: ${destinationPath}`);
                    }
                    if (hasSymlinkInPath(destinationPath, this.root)) {
                        Helpers.die(`Managed skill destination contains a symbolic link: ${destinationPath}`);
                    }
                    if (!SkillInstaller.isPathInsideRoot(destinationPath, agentSkillDir)) {
                        Helpers.die(`Managed skill destination escapes agent skills directory: ${destinationPath}`);
                    }

                    SkillInstaller.removeDirectory(destinationPath, agentSkillDir);
                });
            });

            return {
                ok: true,
                status: 0,
                cmd: ['internal-remove'],
            };
        }
        catch (error) {
            return this.createFailure(['internal-remove'], error);
        }
    }

    private resolveAgentProjectSkillDirs(agents: string[]): AgentProjectSkillDirsResult {
        return new AgentProjectResolver({ root: this.root }).resolveSkillDirs(agents);
    }

    private normalizeSkillEntries(skillEntries: unknown[]): BackendSkillEntry[] {
        const byPath = new Map<string, BackendSkillEntry>();
        (Array.isArray(skillEntries) ? skillEntries : []).forEach((entry: unknown) => {
            const normalizedEntry = (entry && typeof entry === 'object') ? entry as { [key: string]: unknown } : {};
            const sourcePath = typeof normalizedEntry.sourcePath === 'string'
                ? normalizedEntry.sourcePath.trim()
                : '';
            if (!sourcePath || byPath.has(sourcePath)) {
                return;
            }

            const name = typeof normalizedEntry.name === 'string'
                ? normalizedEntry.name.trim()
                : '';
            byPath.set(sourcePath, {
                name: name || sourcePath,
                sourcePath,
            });
        });

        return [...byPath.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
    }

    private resolveSourceSkillsRootPrefix(skillEntries: { sourcePath?: string }[]): { ok: boolean; error?: string; prefix?: string } {
        const prefixes = Helpers.sortUniq(
            (Array.isArray(skillEntries) ? skillEntries : [])
                .map(entry => extractSkillsRootPrefix(entry.sourcePath))
                .filter((value): value is string => Boolean(value)),
        );

        if (prefixes.length === 0) {
            return { ok: false, error: 'Cannot infer source skills root from skill entries.' };
        }
        if (prefixes.length > 1) {
            return { ok: false, error: `Multiple skills roots detected: ${prefixes.join(', ')}` };
        }

        return { ok: true, prefix: prefixes[0] };
    }

    private createFailure(cmd: string[], error: unknown): BackendCommandResult {
        const errorWithDetails = error as ErrorWithDetails;
        return {
            ok: false,
            status: 1,
            cmd,
            error: errorWithDetails instanceof Error ? errorWithDetails.message : String(errorWithDetails),
            details: errorWithDetails.details,
        };
    }
}
