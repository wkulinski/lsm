import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface DirectoryFileHash {
    path: string;
    sha256: string;
}

export interface DirectoryHash {
    treeSha256: string;
    files: DirectoryFileHash[];
}

interface CollectedDirectoryFile {
    relativePath: string;
    absolutePath: string;
}

export default class Hashing {
    public static sha256Buffer(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    public static sha256File(filePath: string): string {
        return Hashing.sha256Buffer(fs.readFileSync(filePath));
    }

    public static hashDirectory(dirPath: string): DirectoryHash | null {
        if (!fs.existsSync(dirPath)) {
            return null;
        }

        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
            return null;
        }

        const files = Hashing._collectDirectoryFiles(dirPath).map(entry => ({
            path: entry.relativePath,
            sha256: Hashing.sha256File(entry.absolutePath),
        }));

        const treePayload = files
            .map(entry => `${entry.path}\0${entry.sha256}`)
            .join('\n');

        return {
            treeSha256: Hashing.sha256Buffer(Buffer.from(treePayload, 'utf8')),
            files,
        };
    }

    public static _collectDirectoryFiles(basePath: string, currentRelativePath = ''): CollectedDirectoryFile[] {
        const readPath = currentRelativePath ? path.join(basePath, currentRelativePath) : basePath;
        const entries = fs.readdirSync(readPath, { withFileTypes: true });
        const files: CollectedDirectoryFile[] = [];

        entries.forEach((entry) => {
            const nestedRelativePath = currentRelativePath
                ? path.join(currentRelativePath, entry.name)
                : entry.name;

            if (entry.isSymbolicLink()) {
                return;
            }

            if (entry.isDirectory()) {
                const nestedFiles = Hashing._collectDirectoryFiles(basePath, nestedRelativePath);
                nestedFiles.forEach(nestedFile => files.push(nestedFile));
                return;
            }

            if (!entry.isFile()) {
                return;
            }

            files.push({
                relativePath: nestedRelativePath.split(path.sep).join('/'),
                absolutePath: path.join(basePath, nestedRelativePath),
            });
        });

        return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }
}
