import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import DirectoryCopier from '../src/core/filesystem/DirectoryCopier';
import FileSystem from '../src/core/filesystem/FileSystem';
import { createTempDir } from './helpers';

describe('FileSystem', () => {
    test('creates, reads, copies and removes filesystem entries', () => {
        const root = createTempDir();
        const fileSystem = new FileSystem();

        try {
            const source = path.join(root, 'source.txt');
            const target = path.join(root, 'nested', 'target.txt');
            fs.writeFileSync(source, 'content', 'utf8');

            expect(fileSystem.exists(source)).toBe(true);
            expect(fileSystem.lstat(source).isFile()).toBe(true);
            expect(fileSystem.readFile(source).toString()).toBe('content');
            fileSystem.ensureParentDirectory(target);
            fileSystem.copyFile(source, target);
            expect(fileSystem.stat(target).isFile()).toBe(true);
            fileSystem.remove(path.dirname(target), true);
            expect(fileSystem.exists(path.dirname(target))).toBe(false);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('cleans only empty parents inside the configured root', () => {
        const root = createTempDir();
        const fileSystem = new FileSystem();
        const nested = path.join(root, 'a', 'b', 'c');

        try {
            fs.mkdirSync(nested, { recursive: true });
            fileSystem.cleanupEmptyParents(nested, root);
            expect(fs.existsSync(path.join(root, 'a'))).toBe(false);
            expect(fs.existsSync(root)).toBe(true);

            fs.mkdirSync(path.join(root, 'keep'), { recursive: true });
            fs.writeFileSync(path.join(root, 'keep', 'file.txt'), 'keep', 'utf8');
            fileSystem.cleanupEmptyParents(path.join(root, 'keep'), root);
            expect(fs.existsSync(path.join(root, 'keep'))).toBe(true);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('treats cleanup as best effort', () => {
        const fileSystem = new FileSystem();
        const remove = vi.spyOn(fileSystem, 'remove').mockImplementation(() => {
            throw new Error('cleanup failed');
        });

        expect(() => {
            fileSystem.cleanupTempDir('/tmp/temporary');
        }).not.toThrow();
        expect(() => {
            fileSystem.cleanupTempDir(null);
        }).not.toThrow();
        expect(remove).toHaveBeenCalledWith('/tmp/temporary', true);
    });
});

describe('DirectoryCopier', () => {
    test('copies regular files in stable order and skips source symlinks', () => {
        const root = createTempDir();
        const source = path.join(root, 'source');
        const clone = path.join(root, 'clone');

        try {
            fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
            fs.writeFileSync(path.join(source, 'z.txt'), 'z', 'utf8');
            fs.writeFileSync(path.join(source, 'nested', 'a.txt'), 'a', 'utf8');
            fs.symlinkSync(path.join(source, 'z.txt'), path.join(source, 'link.txt'));

            const copier = new DirectoryCopier();
            expect(copier.collectFilesRecursively(source).map(file => file.relativePath)).toEqual([
                'nested/a.txt',
                'z.txt',
            ]);
            expect(copier.copyDirectory({ sourceDir: source, cloneDir: clone, targetBasePath: 'skills/example' })).toEqual([
                'skills/example/nested/a.txt',
                'skills/example/z.txt',
            ]);
            expect(fs.readFileSync(path.join(clone, 'skills/example/nested/a.txt'), 'utf8')).toBe('a');
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rejects a symlink anywhere in the publish target path', () => {
        const root = createTempDir();
        const source = path.join(root, 'source');
        const clone = path.join(root, 'clone');
        const outside = path.join(root, 'outside');

        try {
            fs.mkdirSync(source, { recursive: true });
            fs.mkdirSync(outside, { recursive: true });
            fs.mkdirSync(clone, { recursive: true });
            fs.writeFileSync(path.join(source, 'file.txt'), 'content', 'utf8');
            fs.symlinkSync(outside, path.join(clone, 'skills'));

            expect(() => new DirectoryCopier().copyDirectory({
                sourceDir: source,
                cloneDir: clone,
                targetBasePath: 'skills/example',
            })).toThrow('symbolic link');
            expect(fs.readdirSync(outside)).toEqual([]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('does not copy a target outside the clone root', () => {
        const root = createTempDir();
        const source = path.join(root, 'source');
        const clone = path.join(root, 'clone');

        try {
            fs.mkdirSync(source, { recursive: true });
            fs.writeFileSync(path.join(source, 'file.txt'), 'content', 'utf8');

            expect(new DirectoryCopier().copyDirectory({
                sourceDir: source,
                cloneDir: clone,
                targetBasePath: '../outside',
            })).toEqual([]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
