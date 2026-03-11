import fs from "node:fs";
import path from "node:path";

import Helpers from "./Helpers.mjs";

export default class SkillInstaller {
    static writeDirectory(targetDir, files) {
        fs.rmSync(targetDir, { recursive: true, force: true });
        fs.mkdirSync(targetDir, { recursive: true });

        (Array.isArray(files) ? files : []).forEach((fileEntry) => {
            const relativePath = SkillInstaller.normalizeRelativePath(fileEntry?.path, "files.path");
            const destinationPath = path.resolve(targetDir, relativePath);
            if (!SkillInstaller.isPathInsideRoot(destinationPath, targetDir)) {
                Helpers.die(`Skill file path escapes target directory: ${relativePath}`);
            }

            const parentDir = path.dirname(destinationPath);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }

            fs.writeFileSync(destinationPath, fileEntry.content);
        });
    }

    static removeDirectory(targetDir, boundaryDir) {
        if (!fs.existsSync(targetDir)) {
            return;
        }

        const stat = fs.statSync(targetDir);
        if (!stat.isDirectory()) {
            Helpers.die(`Managed skill path is not a directory: ${targetDir}`);
        }

        fs.rmSync(targetDir, { recursive: true, force: true });
        SkillInstaller.cleanupEmptyParents(path.dirname(targetDir), boundaryDir);
    }

    static cleanupEmptyParents(startDirectoryPath, boundaryDir) {
        let currentDirectoryPath = path.resolve(startDirectoryPath);
        const resolvedBoundaryDir = path.resolve(boundaryDir);

        while (SkillInstaller.isPathInsideRoot(currentDirectoryPath, resolvedBoundaryDir) && currentDirectoryPath !== resolvedBoundaryDir) {
            if (!fs.existsSync(currentDirectoryPath)) {
                currentDirectoryPath = path.dirname(currentDirectoryPath);
                continue;
            }

            const entries = fs.readdirSync(currentDirectoryPath);
            if (entries.length > 0) {
                break;
            }

            fs.rmdirSync(currentDirectoryPath);
            currentDirectoryPath = path.dirname(currentDirectoryPath);
        }
    }

    static normalizeRelativePath(value, fieldName) {
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

    static isPathInsideRoot(candidatePath, rootPath) {
        const relative = path.relative(rootPath, candidatePath);
        return !(relative.startsWith("..") || path.isAbsolute(relative));
    }
}
