import fs from "node:fs";
import path from "node:path";

import AgentRegistry from "./AgentRegistry.mjs";
import Helpers from "./Helpers.mjs";
import SkillDiscovery from "./SkillDiscovery.mjs";
import SkillInstaller from "./SkillInstaller.mjs";

export default class Backend {
    constructor({ root }) {
        this.root = root;
    }

    listSkills(source, options = {}) {
        const discovery = new SkillDiscovery({
            includeInternal: options.includeInternal ?? false,
            fullDepth: options.fullDepth ?? false,
        });
        return discovery.listSkills(source);
    }

    resolveSource(source) {
        const discovery = new SkillDiscovery();
        return discovery.resolveSource(source);
    }

    collectSharedFiles(source, sharedFiles) {
        const discovery = new SkillDiscovery();
        return discovery.collectSharedFiles(source, sharedFiles);
    }

    installSkillEntries({ source, skillEntries, agents }) {
        const dirsResult = this.resolveAgentProjectSkillDirs(agents);
        if (!dirsResult.ok) {
            return {
                ok: false,
                status: 1,
                cmd: ["internal-install", source],
                error: dirsResult.error,
            };
        }

        const normalizedEntries = this._normalizeSkillEntries(skillEntries);
        if (normalizedEntries.length === 0) {
            return {
                ok: true,
                status: 0,
                cmd: ["internal-install", source],
            };
        }

        const sourceSkillsRoot = this._resolveSourceSkillsRootPrefix(normalizedEntries);
        if (!sourceSkillsRoot.ok) {
            return {
                ok: false,
                status: 1,
                cmd: ["internal-install", source],
                error: sourceSkillsRoot.error,
            };
        }

        const discovery = new SkillDiscovery();
        const collected = discovery.collectSkillDirectories(
            source,
            normalizedEntries.map((entry) => entry.sourcePath),
        );
        if (!collected.ok) {
            return {
                ok: false,
                status: 1,
                cmd: ["internal-install", source],
                error: collected.error,
                details: collected.details,
            };
        }

        try {
            dirsResult.dirs.forEach((agentSkillDir) => {
                collected.directories.forEach((directoryEntry) => {
                    const relativePath = this._relativeToSkillsRoot(directoryEntry.sourcePath, sourceSkillsRoot.prefix);
                    if (!relativePath) {
                        Helpers.die(`Skill path does not match source skills root (${sourceSkillsRoot.prefix}): ${directoryEntry.sourcePath}`);
                    }

                    const destinationPath = path.resolve(agentSkillDir, relativePath);
                    if (!this._isPathInsideRoot(destinationPath)) {
                        Helpers.die(`Skill destination escapes project root: ${destinationPath}`);
                    }

                    SkillInstaller.writeDirectory(destinationPath, directoryEntry.files);
                });
            });

            return {
                ok: true,
                status: 0,
                cmd: ["internal-install", source],
            };
        } catch (error) {
            return {
                ok: false,
                status: 1,
                cmd: ["internal-install", source],
                error: error instanceof Error ? error.message : String(error),
                details: error instanceof Error ? error.details : undefined,
            };
        }
    }

    removeSkillEntries({ skillEntries, agents }) {
        const dirsResult = this.resolveAgentProjectSkillDirs(agents);
        if (!dirsResult.ok) {
            return {
                ok: false,
                status: 1,
                cmd: ["internal-remove"],
                error: dirsResult.error,
            };
        }

        const normalizedEntries = this._normalizeSkillEntries(skillEntries);
        if (normalizedEntries.length === 0) {
            return {
                ok: true,
                status: 0,
                cmd: ["internal-remove"],
            };
        }

        try {
            dirsResult.dirs.forEach((agentSkillDir) => {
                normalizedEntries.forEach((entry) => {
                    const sourceSkillsRoot = this._extractSkillsRootPrefix(entry.sourcePath);
                    if (!sourceSkillsRoot) {
                        Helpers.die(`Cannot infer source skills root from skill path: ${entry.sourcePath}`);
                    }

                    const relativePath = this._relativeToSkillsRoot(entry.sourcePath, sourceSkillsRoot);
                    if (!relativePath) {
                        Helpers.die(`Skill path does not match source skills root (${sourceSkillsRoot}): ${entry.sourcePath}`);
                    }

                    const destinationPath = path.resolve(agentSkillDir, relativePath);
                    if (!this._isPathInsideRoot(destinationPath)) {
                        Helpers.die(`Managed skill destination escapes project root: ${destinationPath}`);
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
                cmd: ["internal-remove"],
            };
        } catch (error) {
            return {
                ok: false,
                status: 1,
                cmd: ["internal-remove"],
                error: error instanceof Error ? error.message : String(error),
                details: error instanceof Error ? error.details : undefined,
            };
        }
    }

    resolveAgentProjectSkillDirs(agents) {
        if (!Array.isArray(agents) || agents.length === 0) {
            return { ok: false, error: "No agents configured for copy sync." };
        }

        const resolved = [];
        for (const agent of agents) {
            const normalizedAgent = String(agent).trim().toLowerCase();
            if (!normalizedAgent || normalizedAgent === "*") {
                return { ok: false, error: "Copy sync requires explicit agent names (wildcard '*' is not supported)." };
            }

            const skillsDir = AgentRegistry.projectSkillsDir(normalizedAgent);
            if (!skillsDir) {
                return {
                    ok: false,
                    error: `Unsupported agent for copy sync: "${agent}". Add mapping in AgentRegistry.`,
                };
            }

            resolved.push(path.resolve(this.root, skillsDir));
        }

        return { ok: true, dirs: Helpers.sortUniq(resolved) };
    }

    getVersion() {
        const packageJsonPath = path.resolve(this.root, "package.json");
        if (!fs.existsSync(packageJsonPath)) {
            return { ok: false, status: 1, stdout: "", stderr: `package.json not found: ${packageJsonPath}` };
        }

        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
            const version = typeof packageJson.version === "string" ? packageJson.version.trim() : "";
            if (!version) {
                return { ok: false, status: 1, stdout: "", stderr: `Missing "version" in ${packageJsonPath}` };
            }

            return {
                ok: true,
                status: 0,
                stdout: version,
                stderr: "",
            };
        } catch (error) {
            return {
                ok: false,
                status: 1,
                stdout: "",
                stderr: error instanceof Error ? error.message : String(error),
            };
        }
    }

    _normalizeSkillEntries(skillEntries) {
        const byPath = new Map();
        (Array.isArray(skillEntries) ? skillEntries : []).forEach((entry) => {
            const sourcePath = String(entry?.sourcePath ?? "").trim();
            if (!sourcePath || byPath.has(sourcePath)) {
                return;
            }

            byPath.set(sourcePath, {
                name: String(entry?.name ?? "").trim() || sourcePath,
                sourcePath,
            });
        });

        return [...byPath.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
    }

    _resolveSourceSkillsRootPrefix(skillEntries) {
        const prefixes = Helpers.sortUniq(
            (Array.isArray(skillEntries) ? skillEntries : [])
                .map((entry) => this._extractSkillsRootPrefix(entry?.sourcePath))
                .filter(Boolean)
        );

        if (prefixes.length === 0) {
            return { ok: false, error: "Cannot infer source skills root from skill entries." };
        }
        if (prefixes.length > 1) {
            return { ok: false, error: `Multiple skills roots detected: ${prefixes.join(", ")}` };
        }

        return { ok: true, prefix: prefixes[0] };
    }

    _extractSkillsRootPrefix(sourcePath) {
        const normalized = String(sourcePath ?? "").trim().replace(/\\/g, "/");
        if (!normalized) {
            return null;
        }

        const parts = normalized.split("/").filter(Boolean);
        const index = parts.lastIndexOf("skills");
        if (index === -1) {
            return null;
        }

        return parts.slice(0, index + 1).join("/");
    }

    _relativeToSkillsRoot(sourcePath, skillsRootPrefix) {
        const normalizedPath = String(sourcePath ?? "").trim().replace(/\\/g, "/");
        const normalizedRoot = String(skillsRootPrefix ?? "").trim().replace(/\\/g, "/");
        if (!normalizedPath || !normalizedRoot) {
            return null;
        }

        const prefix = `${normalizedRoot}/`;
        if (!normalizedPath.startsWith(prefix)) {
            return null;
        }

        const relativePath = normalizedPath.slice(prefix.length);
        return relativePath || null;
    }

    _isPathInsideRoot(absolutePath) {
        const relative = path.relative(this.root, absolutePath);
        return !(relative.startsWith("..") || path.isAbsolute(relative));
    }
}
