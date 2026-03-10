import fs from "node:fs";
import path from "node:path";

import Helpers from "./Helpers.mjs";

const LOCK_SCHEMA_VERSION = 5;
const DEFAULT_JSON_INDENT = 4;

export default class Manifest {
    constructor({ manifestPath, lockPath }) {
        this.manifestPath = manifestPath;
        this.lockPath = lockPath;
    }

    static resolveManifestPath(argv, { root, defaultManifest }) {
        const idx = argv.indexOf("--manifest");
        if (idx === -1) { return defaultManifest; }

        const val = argv[idx + 1];
        if (!val || val.startsWith("--")) { Helpers.die("Missing value for --manifest"); }
        return path.isAbsolute(val) ? val : path.resolve(root, val);
    }

    ensureFiles() {
        const created = [];

        if (!fs.existsSync(this.manifestPath)) {
            this._ensureDirForFile(this.manifestPath);
            this._writeJson(this.manifestPath, { agents: [], sources: [] });
            created.push(this.manifestPath);
        }

        if (!fs.existsSync(this.lockPath)) {
            this._ensureDirForFile(this.lockPath);
            this._writeJson(this.lockPath, {
                schemaVersion: LOCK_SCHEMA_VERSION,
                generatedAt: new Date().toISOString(),
                agents: [],
                sources: {},
            });
            created.push(this.lockPath);
        }

        return created;
    }

    loadManifest() {
        const json = this._loadJson(this.manifestPath);
        this._ensureNonEmptyStringArray("agents", json.agents);

        const sources = json.sources ?? [];
        if (!Array.isArray(sources)) {
            Helpers.die(`"${path.basename(this.manifestPath)}": "sources" must be an array`);
        }
        if (sources.length === 0) {
            return { agents: Helpers.sortUniq(json.agents.map((x) => x.trim())), sources: [] };
        }

        const normalized = sources.map((e) => {
            if (!e?.source || typeof e.source !== "string" || !e.source.trim()) {
                Helpers.die(`"${path.basename(this.manifestPath)}": each source entry needs {"source": "..."}`);
            }

            const hasSkills = Object.hasOwn(e, "skills");
            if (hasSkills && !Array.isArray(e.skills)) {
                Helpers.die(`"${path.basename(this.manifestPath)}": "skills" must be an array when present`);
            }

            if (Object.hasOwn(e, "copies")) {
                Helpers.die(`"${path.basename(this.manifestPath)}": "copies" is no longer supported; use skill frontmatter "shared_files"`);
            }

            const hasPublish = Object.hasOwn(e, "publish");
            if (hasPublish && (!e.publish || typeof e.publish !== "object" || Array.isArray(e.publish))) {
                Helpers.die(`"${path.basename(this.manifestPath)}": "publish" must be an object when present`);
            }

            const skills = Array.isArray(e.skills)
                ? Helpers.sortUniq(e.skills.map((x) => String(x).trim()).filter(Boolean))
                : null;
            if (skills) { skills.forEach((s) => (!s ? Helpers.die(`"${path.basename(this.manifestPath)}": "skills" contains empty value`) : null)); }

            const publish = hasPublish
                ? this._normalizeManifestPublish(e.publish)
                : {
                    branchPrefix: null,
                    createPr: null,
                };

            return { source: e.source.trim(), skills, publish };
        });

        return { agents: Helpers.sortUniq(json.agents.map((x) => x.trim())), sources: normalized };
    }

    loadLock() {
        if (!fs.existsSync(this.lockPath)) {
            return { schemaVersion: LOCK_SCHEMA_VERSION, agents: [], sources: {} };
        }

        const json = this._loadJson(this.lockPath);
        if (json.schemaVersion !== LOCK_SCHEMA_VERSION) {
            Helpers.die(
                `"${path.basename(this.lockPath)}": unsupported schemaVersion=${json.schemaVersion}; expected ${LOCK_SCHEMA_VERSION}`
            );
        }
        const agents = Array.isArray(json.agents) ? json.agents.map(String).map((s) => s.trim()).filter(Boolean) : [];
        const sources = this._normalizeLockSources(json.sources);

        return {
            schemaVersion: LOCK_SCHEMA_VERSION,
            agents: Helpers.sortUniq(agents),
            sources,
        };
    }

    lockManagedSkills(lockSources) {
        return Helpers.sortUniq(
            Object.values(lockSources ?? {})
                .flatMap((v) => (Array.isArray(v?.skillEntries) ? v.skillEntries : []))
                .map((entry) => String(entry?.name ?? "").trim())
                .map(String)
                .map((s) => s.trim())
                .filter(Boolean)
        );
    }

    writeLock({ agents, sources }) {
        this._writeJson(this.lockPath, {
            schemaVersion: LOCK_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            agents: Helpers.sortUniq(agents),
            sources,
        });
    }

    lockManagedSharedFilesBySource(lockSources) {
        const normalizedSources = this._normalizeLockSources(lockSources);
        return Object.fromEntries(
            Object.entries(normalizedSources).map(([source, meta]) => {
                const files = Helpers.sortUniq([
                    ...(meta.sharedFileHashes ?? []).map((entry) => String(entry.path ?? "").trim()),
                    ...(meta.skillEntries ?? [])
                        .flatMap((entry) => (Array.isArray(entry.sharedFiles) ? entry.sharedFiles : []))
                        .map((filePath) => String(filePath).trim()),
                ].filter(Boolean));
                return [source, files];
            })
        );
    }

    _loadJson(filePath) {
        if (!fs.existsSync(filePath)) {
            Helpers.die(`File not found: ${filePath}`);
            return null;
        }
        try {
            return JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (e) {
            Helpers.die(`Invalid JSON: ${filePath}\n${String(e)}`);
            return null;
        }
    }

    _writeJson(filePath, obj, indent = DEFAULT_JSON_INDENT) {
        fs.writeFileSync(filePath, `${JSON.stringify(obj, null, indent)}\n`, "utf8");
    }

    _ensureDirForFile(filePath) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    }

    _ensureNonEmptyStringArray(name, v) {
        if (!Array.isArray(v) || v.length === 0) { Helpers.die(`"${name}" must be a non-empty array`); }
        v.forEach((x) => {
            if (typeof x !== "string" || !x.trim()) { Helpers.die(`"${name}" contains empty/non-string value`); }
        });
    }

    _normalizeManifestPublish(publish) {
        const result = {
            branchPrefix: null,
            createPr: null,
        };

        if (Object.hasOwn(publish, "branchPrefix")) {
            if (typeof publish.branchPrefix !== "string" || !publish.branchPrefix.trim()) {
                Helpers.die(`"${path.basename(this.manifestPath)}": "publish.branchPrefix" must be a non-empty string`);
            }
            result.branchPrefix = publish.branchPrefix.trim();
        }

        if (Object.hasOwn(publish, "createPr")) {
            if (typeof publish.createPr !== "boolean") {
                Helpers.die(`"${path.basename(this.manifestPath)}": "publish.createPr" must be boolean`);
            }
            result.createPr = publish.createPr;
        }

        if (Object.hasOwn(publish, "includeNewByDefault")) {
            Helpers.die(`"${path.basename(this.manifestPath)}": "publish.includeNewByDefault" is no longer supported`);
        }

        return result;
    }

    _normalizeLockSources(rawSources) {
        if (!rawSources || typeof rawSources !== "object") { return {}; }

        return Object.fromEntries(
            Object.entries(rawSources).map(([source, meta]) => {
                const normalizedMeta = meta && typeof meta === "object" ? meta : {};

                return [source, {
                    mode: typeof normalizedMeta.mode === "string" ? normalizedMeta.mode : "all",
                    listedAt: typeof normalizedMeta.listedAt === "string" ? normalizedMeta.listedAt : null,
                    skillEntries: this._normalizeLockSkillEntries(normalizedMeta.skillEntries),
                    sharedFileHashes: this._normalizeLockSharedFileHashes(normalizedMeta.sharedFileHashes),
                    resolved: this._normalizeLockResolved(normalizedMeta.resolved),
                }];
            })
        );
    }

    _normalizeLockSkillEntries(entries) {
        if (!Array.isArray(entries)) {
            Helpers.die(`"${path.basename(this.lockPath)}": "skillEntries" must be an array`);
        }

        const normalized = entries
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => {
                const name = String(entry.name ?? "").trim();
                if (!name) {
                    return null;
                }

                const sourcePath = this._normalizeRelativePath(
                    entry.sourcePath ?? "",
                    "lock.skillEntries.sourcePath",
                    path.basename(this.lockPath)
                );

                const sharedFiles = Helpers.sortUniq(
                    (Array.isArray(entry.sharedFiles) ? entry.sharedFiles : [])
                        .map((sharedFilePath) => this._normalizeRelativePath(
                            sharedFilePath,
                            "lock.skillEntries.sharedFiles",
                            path.basename(this.lockPath)
                        ))
                );

                const hash = this._normalizeLockSkillHash(entry.hash);

                return { name, sourcePath, sharedFiles, hash };
            })
            .filter(Boolean);

        const unique = new Map();
        normalized.forEach((entry) => {
            const key = entry.name.toLowerCase();
            if (!unique.has(key)) {
                unique.set(key, entry);
            }
        });

        return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    _normalizeLockSkillHash(hash) {
        if (!hash || typeof hash !== "object") {
            return null;
        }

        const treeSha256 = typeof hash.treeSha256 === "string" ? hash.treeSha256.trim() : "";
        if (!treeSha256) {
            return null;
        }

        const files = Array.isArray(hash.files)
            ? hash.files
                .filter((entry) => entry && typeof entry === "object")
                .map((entry) => {
                    const relativePath = this._normalizeRelativePath(
                        entry.path ?? "",
                        "lock.skillEntries.hash.files.path",
                        path.basename(this.lockPath)
                    );
                    const sha256 = typeof entry.sha256 === "string" ? entry.sha256.trim() : "";
                    if (!sha256) {
                        return null;
                    }

                    return { path: relativePath, sha256 };
                })
                .filter(Boolean)
            : [];

        return {
            treeSha256,
            files: files.sort((a, b) => a.path.localeCompare(b.path)),
        };
    }

    _normalizeLockSharedFileHashes(entries) {
        if (!Array.isArray(entries)) {
            return [];
        }

        const unique = new Map();
        entries.forEach((entry) => {
            if (!entry || typeof entry !== "object") {
                return;
            }

            const filePath = this._normalizeRelativePath(
                entry.path ?? "",
                "lock.sharedFileHashes.path",
                path.basename(this.lockPath)
            );
            const sha256 = typeof entry.sha256 === "string" ? entry.sha256.trim() : "";
            if (!sha256) {
                return;
            }

            if (!unique.has(filePath)) {
                unique.set(filePath, { path: filePath, sha256 });
            }
        });

        return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
    }

    _normalizeLockResolved(resolved) {
        if (!resolved || typeof resolved !== "object") {
            return {
                requestedRef: null,
                defaultBranch: null,
                resolvedRef: null,
                resolvedCommit: null,
                subpath: null,
                resolvedAt: null,
            };
        }

        const normalizeNullableString = (value) => {
            if (typeof value !== "string") {
                return null;
            }
            const trimmed = value.trim();
            return trimmed ? trimmed : null;
        };

        return {
            requestedRef: normalizeNullableString(resolved.requestedRef),
            defaultBranch: normalizeNullableString(resolved.defaultBranch),
            resolvedRef: normalizeNullableString(resolved.resolvedRef),
            resolvedCommit: normalizeNullableString(resolved.resolvedCommit),
            subpath: normalizeNullableString(resolved.subpath),
            resolvedAt: normalizeNullableString(resolved.resolvedAt),
        };
    }

    _normalizeRelativePath(value, fieldName, sourceLabel = path.basename(this.manifestPath)) {
        if (typeof value !== "string") {
            Helpers.die(`"${sourceLabel}": "${fieldName}" must be a string`);
        }

        const normalizedSlashes = value.trim().replace(/\\/g, "/");
        if (!normalizedSlashes) {
            Helpers.die(`"${sourceLabel}": "${fieldName}" cannot be empty`);
        }

        if (normalizedSlashes.startsWith("/") || /^[A-Za-z]:\//.test(normalizedSlashes)) {
            Helpers.die(`"${sourceLabel}": "${fieldName}" must be a relative path`);
        }

        const tokens = normalizedSlashes
            .split("/")
            .filter((token) => token.length > 0 && token !== ".");

        if (tokens.some((token) => token === "..")) {
            Helpers.die(`"${sourceLabel}": "${fieldName}" cannot contain ".."`);
        }

        return tokens.length > 0 ? tokens.join("/") : ".";
    }
}
