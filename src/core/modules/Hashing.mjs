import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export default class Hashing {
    static sha256Buffer(buffer) {
        return crypto.createHash("sha256").update(buffer).digest("hex");
    }

    static sha256File(filePath) {
        return Hashing.sha256Buffer(fs.readFileSync(filePath));
    }

    static hashDirectory(dirPath) {
        if (!fs.existsSync(dirPath)) {
            return null;
        }

        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
            return null;
        }

        const files = Hashing._collectDirectoryFiles(dirPath).map((entry) => ({
            path: entry.relativePath,
            sha256: Hashing.sha256File(entry.absolutePath),
        }));

        const treePayload = files
            .map((entry) => `${entry.path}\0${entry.sha256}`)
            .join("\n");

        return {
            treeSha256: Hashing.sha256Buffer(Buffer.from(treePayload, "utf8")),
            files,
        };
    }

    static _collectDirectoryFiles(basePath, currentRelativePath = "") {
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
                const nestedFiles = Hashing._collectDirectoryFiles(basePath, nestedRelativePath);
                nestedFiles.forEach((nestedFile) => files.push(nestedFile));
                return;
            }

            if (!entry.isFile()) {
                return;
            }

            files.push({
                relativePath: nestedRelativePath.split(path.sep).join("/"),
                absolutePath: path.join(basePath, nestedRelativePath),
            });
        });

        return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }
}
