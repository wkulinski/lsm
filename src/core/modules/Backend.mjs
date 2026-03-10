import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import Helpers from "./Helpers.mjs";
import SkillDiscovery from "./SkillDiscovery.mjs";

export default class Backend {
    constructor({ root, requireFn, maxBuffer, disableTelemetry }) {
        this.root = root;
        this.requireFn = requireFn;
        this.maxBuffer = maxBuffer;
        this.disableTelemetry = disableTelemetry;
        this.cli = this._resolveCli();
        this.agentProjectDirs = this._resolveAgentProjectDirs();
    }

    _resolveCli() {
        let cliSpec;
        try {
            cliSpec = this.requireFn.resolve("skills/bin/cli.mjs");
        } catch (e) {
            Helpers.die('Dependency "skills" not found in the current workspace. Install it before using lsm.');
        }

        if (!fs.existsSync(cliSpec)) {
            Helpers.die(`Dependency "skills" was resolved, but its CLI entry is missing: ${cliSpec}`);
        }

        return { mode: "local", cmd: process.execPath, args: [cliSpec] };
    }

    _resolveAgentProjectDirs() {
        const fallback = new Map([
            ["codex", ".agents/skills"],
        ]);

        const cliEntryPath = this.cli.args?.[0];
        if (!cliEntryPath) {
            return fallback;
        }

        const distPath = path.resolve(path.dirname(cliEntryPath), "../dist/cli.mjs");
        if (!fs.existsSync(distPath)) {
            return fallback;
        }

        const content = fs.readFileSync(distPath, "utf8");
        const matches = [...content.matchAll(/["']?([a-z0-9-]+)["']?\s*:\s*{[\s\S]*?skillsDir:\s*"([^"]+)"/g)];
        if (!matches.length) {
            return fallback;
        }

        const parsed = new Map();
        matches.forEach((match) => {
            const agentName = String(match[1] ?? "").trim();
            const skillsDir = String(match[2] ?? "").trim();
            if (!agentName || !skillsDir) {
                return;
            }
            parsed.set(agentName, skillsDir);
        });

        return parsed.size > 0 ? parsed : fallback;
    }

    exec(args, { capture = false } = {}) {
        const cmd = [this.cli.cmd, ...this.cli.args, ...args];
        const options = {
            cwd: this.root,
            maxBuffer: this.maxBuffer,
            stdio: capture ? "pipe" : "inherit",
            env: { ...process.env, DISABLE_TELEMETRY: this.disableTelemetry },
        };

        if (capture) {
            options.encoding = "utf8";
        }

        const r = spawnSync(cmd[0], cmd.slice(1), options);

        return {
            ok: r.status === 0,
            status: r.status ?? 1,
            cmd,
            stdout: capture ? (r.stdout ?? "") : "",
            stderr: capture ? (r.stderr ?? "") : "",
        };
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

    removeSkills({ skills, agents }) {
        return this.exec(["remove", "--agent", ...agents, "-y", ...skills]);
    }

    addSelected({ source, skills, agents }) {
        return this.exec(["add", source, "--agent", ...agents, "-y", "--skill", ...skills]);
    }

    addAllFromSource({ source, agents }) {
        return this.exec(["add", source, "--agent", ...agents, "--skill", "*", "-y"]);
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

            const skillsDir = this.agentProjectDirs.get(normalizedAgent);
            if (!skillsDir) {
                return {
                    ok: false,
                    error: `Unsupported agent for copy sync: "${agent}". Add mapping in skills package or Backend._resolveAgentProjectDirs().`,
                };
            }

            resolved.push(path.resolve(this.root, skillsDir));
        }

        return { ok: true, dirs: Helpers.sortUniq(resolved) };
    }

    getVersion() {
        return this.exec(["--version"], { capture: true });
    }
}
