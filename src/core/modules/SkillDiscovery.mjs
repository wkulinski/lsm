import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";

import Helpers from "./Helpers.mjs";
import Hashing from "./Hashing.mjs";

export default class SkillDiscovery {
    constructor({ includeInternal = false, fullDepth = false } = {}) {
        this.includeInternal = includeInternal;
        this.fullDepth = fullDepth;
        this.skipDirs = new Set([
            "node_modules",
            ".git",
            "dist",
            "build",
        ]);
        this.sourceHandlers = [
            {
                name: "github",
                parse: (source) => this._parseGitHubSource(source),
            },
        ];
    }

    resolveSource(source) {
        const resolved = this._resolveSource(source);
        if (!resolved.ok) {
            return resolved;
        }

        const webUrl = resolved.url.replace(/\.git$/, "");
        return {
            ...resolved,
            webUrl,
        };
    }

    listSkills(source) {
        const resolved = this.resolveSource(source);
        if (!resolved.ok) {
            return { ok: false, error: resolved.error };
        }

        const defaultBranch = this._detectDefaultBranch(resolved.url);
        const clone = this._cloneRepo({ url: resolved.url, ref: resolved.ref, depth: 1 });
        if (!clone.ok) {
            return { ok: false, error: clone.error, details: clone.details };
        }

        try {
            const { skills, aliasMap } = this.discover(clone.dir, resolved.subpath);
            if (skills.length === 0) {
                return {
                    ok: false,
                    error: `No skills found in ${source}`,
                };
            }

            const skillEntries = skills
                .map((skill) => ({
                    name: skill.name,
                    sourcePath: this._toPosixPath(path.relative(clone.dir, skill.path)),
                    sharedFiles: Helpers.sortUniq(skill.sharedFiles ?? []),
                    hash: Hashing.hashDirectory(skill.path),
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const sharedFileHashes = Helpers.sortUniq(
                skillEntries.flatMap((entry) => entry.sharedFiles ?? [])
            ).map((sharedFilePath) => {
                const absolutePath = path.resolve(clone.dir, sharedFilePath);
                if (!this._isPathInside(absolutePath, clone.dir)) {
                    Helpers.die(`Shared file path escapes source root while hashing: ${sharedFilePath}`);
                }
                if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
                    Helpers.die(`Shared file does not exist while hashing: ${sharedFilePath}`);
                }

                return {
                    path: sharedFilePath,
                    sha256: Hashing.sha256File(absolutePath),
                };
            });

            const resolvedCommitResult = this._gitCapture(clone.dir, ["rev-parse", "HEAD"]);
            const resolvedCommit = resolvedCommitResult.ok ? resolvedCommitResult.stdout.trim() : null;
            const currentBranchResult = this._gitCapture(clone.dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
            const currentBranch = currentBranchResult.ok ? currentBranchResult.stdout.trim() : null;
            const resolvedRef = resolved.ref
                ?? ((currentBranch && currentBranch !== "HEAD") ? currentBranch : (defaultBranch ?? null));

            return {
                ok: true,
                skills: Helpers.sortUniq(skills.map((s) => s.name)),
                skillEntries,
                sharedFileHashes,
                aliasMap,
                resolved: {
                    requestedRef: resolved.ref ?? null,
                    defaultBranch,
                    resolvedRef,
                    resolvedCommit,
                    subpath: resolved.subpath ?? null,
                    resolvedAt: new Date().toISOString(),
                },
            };
        } finally {
            this._cleanupTempDir(clone.dir);
        }
    }

    collectSharedFiles(source, sharedFiles) {
        const resolved = this.resolveSource(source);
        if (!resolved.ok) {
            return { ok: false, error: resolved.error };
        }

        const clone = this._cloneRepo({ url: resolved.url, ref: resolved.ref, depth: 1 });
        if (!clone.ok) {
            return { ok: false, error: clone.error, details: clone.details };
        }

        try {
            const basePath = clone.dir;
            const unique = Helpers.sortUniq(
                (Array.isArray(sharedFiles) ? sharedFiles : [])
                    .map((entry) => this._normalizeRelativePath(entry, "sharedFiles"))
            );

            const files = unique.map((relativePath) => {
                const absolutePath = path.resolve(basePath, relativePath);
                if (!this._isPathInside(absolutePath, basePath)) {
                    return {
                        ok: false,
                        error: `Shared file path escapes source root: ${relativePath}`,
                    };
                }
                if (!fs.existsSync(absolutePath)) {
                    return {
                        ok: false,
                        error: `Shared file does not exist in source: ${relativePath}`,
                    };
                }

                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) {
                    return {
                        ok: false,
                        error: `Shared file path is not a file: ${relativePath}`,
                    };
                }

                return {
                    ok: true,
                    path: relativePath,
                    content: fs.readFileSync(absolutePath),
                };
            });

            const failed = files.find((entry) => !entry.ok);
            if (failed) {
                return { ok: false, error: failed.error };
            }

            return { ok: true, files: files.map((entry) => ({ path: entry.path, content: entry.content })) };
        } finally {
            this._cleanupTempDir(clone.dir);
        }
    }

    discover(basePath, subpath) {
        const skills = [];
        const seen = new Set();
        const aliasMap = new Map();
        const searchPath = subpath ? path.join(basePath, subpath) : basePath;

        if (!fs.existsSync(searchPath)) { return { skills, aliasMap }; }

        const addedRoot = this._collectIfSkillDir(searchPath, skills, seen, aliasMap, { basePath, searchPath });
        if (addedRoot && !this.fullDepth) {
            return { skills, aliasMap };
        }

        this._discoverInPriorityDirs(searchPath, skills, seen, aliasMap, { basePath, searchPath });

        if (skills.length === 0 || this.fullDepth) {
            const allSkillDirs = this._findSkillDirs(searchPath);
            allSkillDirs.forEach((skillDir) => {
                this._collectIfSkillDir(skillDir, skills, seen, aliasMap, { basePath, searchPath });
            });
        }

        return { skills, aliasMap };
    }

    _discoverInPriorityDirs(searchPath, skills, seen, aliasMap, context) {
        const prioritySearchDirs = this._prioritySearchDirs(searchPath);
        prioritySearchDirs.forEach((dir) => {
            this._scanDirectSkillDirs(dir, skills, seen, aliasMap, context);
        });
    }

    _scanDirectSkillDirs(dir, skills, seen, aliasMap, context) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }

        entries.forEach((entry) => {
            if (!entry.isDirectory()) { return; }
            const skillDir = path.join(dir, entry.name);
            this._collectIfSkillDir(skillDir, skills, seen, aliasMap, context);
        });
    }

    _collectIfSkillDir(skillDir, skills, seen, aliasMap, context) {
        if (!this._hasSkillMd(skillDir)) { return false; }
        const skill = this._parseSkillMd(skillDir, context);
        if (!skill) { return false; }
        this._addSkill(skill, skills, seen, aliasMap);
        return true;
    }

    _addSkill(skill, skills, seen, aliasMap) {
        const name = skill?.name?.trim();
        if (!name) { return; }
        const key = name.toLowerCase();
        if (seen.has(key)) { return; }
        skills.push(skill);
        seen.add(key);
        aliasMap.set(key, name);
        const dirName = path.basename(skill.path).toLowerCase();
        if (dirName && !aliasMap.has(dirName)) {
            aliasMap.set(dirName, name);
        }
    }

    _hasSkillMd(dir) {
        return fs.existsSync(path.join(dir, "SKILL.md"));
    }

    _parseSkillMd(skillDir, { basePath, searchPath }) {
        const filePath = path.join(skillDir, "SKILL.md");
        if (!fs.existsSync(filePath)) { return null; }
        try {
            const content = fs.readFileSync(filePath, "utf8");
            const { data } = matter(content);
            if (!data?.name || !data?.description) { return null; }
            const isInternal = data?.metadata?.internal === true;
            if (isInternal && !this.includeInternal) { return null; }

            const sharedFiles = this._normalizeSharedFilesDeclaration({
                value: data?.shared_files,
                skillName: String(data.name).trim(),
                skillDir,
                basePath,
                searchPath,
            });

            return {
                name: String(data.name).trim(),
                description: String(data.description).trim(),
                path: skillDir,
                sharedFiles,
            };
        } catch (e) {
            Helpers.die(`Invalid skill definition in ${filePath}: ${String(e.message ?? e)}`);
            return null;
        }
    }

    _findSkillDirs(dir, depth = 0, maxDepth = 5) {
        if (depth > maxDepth) { return []; }
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return [];
        }

        const found = [];
        if (this._hasSkillMd(dir)) {
            found.push(dir);
        }

        entries.forEach((entry) => {
            if (!entry.isDirectory()) { return; }
            if (this.skipDirs.has(entry.name)) { return; }
            const nested = this._findSkillDirs(path.join(dir, entry.name), depth + 1, maxDepth);
            nested.forEach((item) => found.push(item));
        });

        return found;
    }

    _prioritySearchDirs(searchPath) {
        return [
            searchPath,
            path.join(searchPath, "skills"),
            path.join(searchPath, "skills/.curated"),
            path.join(searchPath, "skills/.experimental"),
            path.join(searchPath, "skills/.system"),
            path.join(searchPath, ".agent/skills"),
            path.join(searchPath, ".agents/skills"),
            path.join(searchPath, ".claude/skills"),
            path.join(searchPath, ".cline/skills"),
            path.join(searchPath, ".codebuddy/skills"),
            path.join(searchPath, ".codex/skills"),
            path.join(searchPath, ".commandcode/skills"),
            path.join(searchPath, ".continue/skills"),
            path.join(searchPath, ".cursor/skills"),
            path.join(searchPath, ".github/skills"),
            path.join(searchPath, ".goose/skills"),
            path.join(searchPath, ".iflow/skills"),
            path.join(searchPath, ".junie/skills"),
            path.join(searchPath, ".kilocode/skills"),
            path.join(searchPath, ".kiro/skills"),
            path.join(searchPath, ".mux/skills"),
            path.join(searchPath, ".neovate/skills"),
            path.join(searchPath, ".opencode/skills"),
            path.join(searchPath, ".openhands/skills"),
            path.join(searchPath, ".pi/skills"),
            path.join(searchPath, ".qoder/skills"),
            path.join(searchPath, ".roo/skills"),
            path.join(searchPath, ".trae/skills"),
            path.join(searchPath, ".windsurf/skills"),
            path.join(searchPath, ".zencoder/skills"),
        ];
    }

    _collectFilesRecursively(basePath, currentRelativePath = "") {
        const readPath = currentRelativePath ? path.join(basePath, currentRelativePath) : basePath;
        const entries = fs.readdirSync(readPath, { withFileTypes: true });
        const files = [];

        entries.forEach((entry) => {
            const nestedRelativePath = currentRelativePath
                ? path.join(currentRelativePath, entry.name)
                : entry.name;

            if (entry.isSymbolicLink()) {
                return;
            }

            if (entry.isDirectory()) {
                const nestedFiles = this._collectFilesRecursively(basePath, nestedRelativePath);
                nestedFiles.forEach((nestedFile) => files.push(nestedFile));
                return;
            }

            if (!entry.isFile()) {
                return;
            }

            const normalizedRelativePath = nestedRelativePath.split(path.sep).join("/");
            files.push({
                relativePath: normalizedRelativePath,
                absolutePath: path.join(basePath, nestedRelativePath),
            });
        });

        return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }

    _resolveSource(source) {
        for (const handler of this.sourceHandlers) {
            const parsed = handler.parse(source);
            if (parsed) { return { ok: true, handler: handler.name, ...parsed }; }
        }

        return { ok: false, error: `Unsupported source: ${source} (allowed: github)` };
    }

    _normalizeGitHubRepo(value) {
        return value.replace(/\.git$/, "");
    }

    _parseGitHubSource(input) {
        let source = input.trim();
        if (source.startsWith("github.com/")) {
            source = `https://${source}`;
        }

        const treeWithPath = source.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/);
        if (treeWithPath) {
            const [, owner, repo, ref, subpath] = treeWithPath;
            return {
                provider: "github",
                url: `https://github.com/${owner}/${this._normalizeGitHubRepo(repo)}.git`,
                ref,
                subpath,
            };
        }

        const treeRef = source.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?$/);
        if (treeRef) {
            const [, owner, repo, ref] = treeRef;
            return {
                provider: "github",
                url: `https://github.com/${owner}/${this._normalizeGitHubRepo(repo)}.git`,
                ref,
                subpath: null,
            };
        }

        const repoUrl = source.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
        if (repoUrl) {
            const [, owner, repo] = repoUrl;
            return {
                provider: "github",
                url: `https://github.com/${owner}/${this._normalizeGitHubRepo(repo)}.git`,
                ref: null,
                subpath: null,
            };
        }

        const shorthand = source.match(/^([^/]+)\/([^/]+?)(?:@([^/]+))?(?:\/(.+))?$/);
        if (shorthand) {
            const [, owner, repo, ref, subpath] = shorthand;
            return {
                provider: "github",
                url: `https://github.com/${owner}/${this._normalizeGitHubRepo(repo)}.git`,
                ref: ref || null,
                subpath: subpath || null,
            };
        }

        return null;
    }

    _cloneRepo({ url, ref, depth = null }) {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-"));
        const args = ["clone"];
        if (Number.isInteger(depth) && depth > 0) {
            args.push("--depth", String(depth));
        }
        if (ref) {
            args.push("--branch", ref);
        }
        args.push(url, tempDir);

        const res = spawnSync("git", args, { encoding: "utf8" });
        if (res.error?.code === "ENOENT") {
            this._cleanupTempDir(tempDir);
            return { ok: false, error: "git not found in PATH" };
        }
        if (res.status !== 0) {
            this._cleanupTempDir(tempDir);
            return { ok: false, error: `Git clone failed (exit=${res.status})`, details: res.stderr || res.stdout };
        }

        return { ok: true, dir: tempDir };
    }

    _detectDefaultBranch(url) {
        const res = spawnSync("git", ["ls-remote", "--symref", url, "HEAD"], { encoding: "utf8" });
        if (res.status !== 0) {
            return null;
        }

        const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
        const match = output.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/);
        return match ? match[1] : null;
    }

    _gitCapture(cwd, args) {
        const res = spawnSync("git", args, { encoding: "utf8", cwd });
        return {
            ok: res.status === 0,
            stdout: res.stdout ?? "",
            stderr: res.stderr ?? "",
        };
    }

    _normalizeSharedFilesDeclaration({ value, skillName, skillDir, basePath, searchPath }) {
        if (value === null || typeof value === "undefined") {
            return [];
        }

        if (!Array.isArray(value)) {
            Helpers.die(`Skill "${skillName}": "shared_files" must be an array`);
        }

        const skillsRootPath = this._resolveSkillsRootPath(skillDir, searchPath);
        const normalized = value.map((entry, index) => {
            const relativeToSkills = this._normalizeRelativePath(entry, `shared_files[${index}]`);
            const absoluteSharedPath = path.resolve(skillsRootPath, relativeToSkills);
            if (!this._isPathInside(absoluteSharedPath, skillsRootPath)) {
                Helpers.die(`Skill "${skillName}": "shared_files[${index}]" escapes skills root`);
            }
            if (!fs.existsSync(absoluteSharedPath)) {
                Helpers.die(`Skill "${skillName}": shared file does not exist: ${relativeToSkills}`);
            }

            const stat = fs.statSync(absoluteSharedPath);
            if (!stat.isFile()) {
                Helpers.die(`Skill "${skillName}": shared file path is not a file: ${relativeToSkills}`);
            }

            return this._toPosixPath(path.relative(basePath, absoluteSharedPath));
        });

        return Helpers.sortUniq(normalized);
    }

    _resolveSkillsRootPath(skillDir, searchPath) {
        const parts = path.resolve(skillDir).split(path.sep);
        const skillsIndexes = [];
        parts.forEach((part, idx) => {
            if (part === "skills") {
                skillsIndexes.push(idx);
            }
        });

        if (skillsIndexes.length === 0) {
            return path.resolve(searchPath);
        }

        const index = skillsIndexes[skillsIndexes.length - 1];
        const root = parts.slice(0, index + 1).join(path.sep) || path.sep;
        return root;
    }

    _normalizeRelativePath(value, fieldName) {
        if (typeof value !== "string") {
            Helpers.die(`"${fieldName}" must be a string`);
        }

        const normalizedSlashes = value.trim().replace(/\\/g, "/");
        if (!normalizedSlashes) {
            Helpers.die(`"${fieldName}" cannot be empty`);
        }

        if (normalizedSlashes.startsWith("/") || /^[A-Za-z]:\//.test(normalizedSlashes)) {
            Helpers.die(`"${fieldName}" must be a relative path`);
        }

        const tokens = normalizedSlashes
            .split("/")
            .filter((token) => token.length > 0 && token !== ".");

        if (tokens.some((token) => token === "..")) {
            Helpers.die(`"${fieldName}" cannot contain ".."`);
        }

        return tokens.length > 0 ? tokens.join("/") : ".";
    }

    _isPathInside(candidatePath, rootPath) {
        const relative = path.relative(rootPath, candidatePath);
        return !(relative.startsWith("..") || path.isAbsolute(relative));
    }

    _toPosixPath(value) {
        return value.split(path.sep).join("/");
    }

    _cleanupTempDir(dir) {
        if (!dir) { return; }
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (e) {
            // best-effort cleanup
        }
    }
}
