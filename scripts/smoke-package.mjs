#!/usr/bin/env node
// Installs the packed @wkulinski/lsm archive into an empty project and checks the
// delivered CLI, the library entry point and the bundled example end to end.
//
//   node scripts/smoke-package.mjs [archive.tgz]
//
// Without an argument the archive is packed from the current checkout (run `npm run build` first).
// With an argument that exact archive is checked and nothing is rebuilt.
// Only Node built-ins are used so the script runs on the oldest supported Node.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleDir = path.join(repositoryRoot, 'examples');
const exampleSourceUrl = 'https://github.com/wkulinski/lsm/tree/master/examples/skill-source';
const exampleRepositoryUrl = 'https://github.com/wkulinski/lsm.git';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    if (result.error) {
        throw result.error;
    }
    return result;
}

function runChecked(command, args, options = {}) {
    const result = run(command, args, options);
    assert.equal(result.status, 0, `${command} ${args.join(' ')} exited with ${String(result.status)}\n${result.stdout}${result.stderr}`);
    return result;
}

function git(cwd, args) {
    return runChecked('git', args, { cwd }).stdout.trim();
}

function step(message) {
    process.stdout.write(`- ${message}\n`);
}

function packArchive(destination) {
    const result = runChecked(npmCommand, ['pack', '--json', '--pack-destination', destination], { cwd: repositoryRoot });
    const [entry] = JSON.parse(result.stdout);
    return path.join(destination, entry.filename);
}

// Local Git fixture holding the same files the documentation points users to.
function createSourceRepository(sourceDir) {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.cpSync(path.join(exampleDir, 'skill-source'), path.join(sourceDir, 'examples', 'skill-source'), { recursive: true });
    git(sourceDir, ['init']);
    git(sourceDir, ['symbolic-ref', 'HEAD', 'refs/heads/master']);
    git(sourceDir, ['add', '.']);
    git(sourceDir, ['-c', 'user.name=LSM Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-m', 'example fixture']);
}

// Process-local Git URL rewriting sends the example URL to the fixture. It never touches user Git config.
function createEnvironment(sourceDir) {
    return {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.${sourceDir}.insteadOf`,
        GIT_CONFIG_VALUE_0: exampleRepositoryUrl,
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
    };
}

function checkInstalledPackage(projectDir, archiveVersion) {
    const packageDir = path.join(projectDir, 'node_modules', '@wkulinski', 'lsm');
    const installed = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    assert.ok(installed.bin?.lsm, 'package.json does not declare the lsm binary');
    const wrapper = path.join(packageDir, installed.bin.lsm);
    assert.ok(fs.existsSync(wrapper), `${installed.bin.lsm} is missing from the installed package`);
    const linked = path.join(projectDir, 'node_modules', '.bin', 'lsm');
    assert.ok(fs.existsSync(linked), 'npm did not link the lsm binary into node_modules/.bin');
    assert.ok(fs.existsSync(path.join(packageDir, 'dist', 'index.mjs')), 'dist/index.mjs is missing from the installed package');
    assert.ok(fs.existsSync(path.join(packageDir, 'dist', 'index.d.mts')), 'dist/index.d.mts is missing from the installed package');
    assert.ok(fs.existsSync(path.join(packageDir, 'LICENSE')), 'LICENSE is missing from the installed package');

    const version = runChecked(process.execPath, [linked, '--version'], { cwd: projectDir }).stdout.trim();
    assert.ok(version.includes(archiveVersion), `lsm --version printed "${version}", expected ${archiveVersion}`);
    step(`CLI reports version ${archiveVersion}`);

    const help = runChecked(process.execPath, [wrapper, '--help'], { cwd: projectDir }).stdout;
    assert.match(help, /sync/, 'lsm --help does not mention the sync command');
    step('CLI help lists the sync command');

    runChecked(process.execPath, [
        '--input-type=module',
        '-e',
        "import { createManager } from '@wkulinski/lsm'; if (typeof createManager !== 'function') { throw new Error('createManager is not a function'); }",
    ], { cwd: projectDir });
    step('createManager() is importable from the package entry point');

    return wrapper;
}

function checkTemplates(wrapper, workDir, env) {
    const emptyDir = path.join(workDir, 'empty');
    fs.mkdirSync(emptyDir);
    const result = run(process.execPath, [wrapper, 'sync'], { cwd: emptyDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.notEqual(result.status, 0, 'sync in an empty directory should ask the user to fill in the templates');
    assert.ok(fs.existsSync(path.join(emptyDir, 'skills.json')), 'skills.json template was not created');
    assert.ok(fs.existsSync(path.join(emptyDir, 'skills.lock.json')), 'skills.lock.json template was not created');
    step('first run creates skills.json and skills.lock.json templates');
}

function checkExampleInstall(wrapper, workDir, env) {
    const workspace = path.join(workDir, 'workspace');
    fs.mkdirSync(workspace);
    fs.copyFileSync(path.join(exampleDir, 'skills.json'), path.join(workspace, 'skills.json'));
    const manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'skills.json'), 'utf8'));
    assert.equal(manifest.sources[0].source, exampleSourceUrl, 'examples/skills.json does not point to the documented source');

    runChecked(process.execPath, [wrapper, 'sync', '--update'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const skill = path.join(workspace, '.agents', 'skills', 'hello-lsm', 'SKILL.md');
    const shared = path.join(workspace, '.agents', 'skills', '_shared', 'hello-lsm.txt');
    const lockPath = path.join(workspace, 'skills.lock.json');
    assert.ok(fs.existsSync(skill), 'hello-lsm skill was not installed');
    assert.ok(fs.existsSync(shared), 'shared file was not installed');
    assert.ok(fs.existsSync(lockPath), 'skills.lock.json was not written');
    assert.equal(
        fs.readFileSync(skill, 'utf8'),
        fs.readFileSync(path.join(exampleDir, 'skill-source', 'skills', 'hello-lsm', 'SKILL.md'), 'utf8'),
    );
    step('sync --update installs the example skill and its shared file');

    const lockBefore = fs.readFileSync(lockPath, 'utf8');
    runChecked(process.execPath, [wrapper, 'sync'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(fs.readFileSync(lockPath, 'utf8'), lockBefore, 'locked sync changed skills.lock.json');
    step('locked sync leaves skills.lock.json unchanged');
}

function main() {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsm-package-smoke-'));
    try {
        const archive = process.argv[2]
            ? path.resolve(process.argv[2])
            : packArchive(workDir);
        assert.ok(fs.existsSync(archive), `Archive does not exist: ${archive}`);
        step(`checking ${path.basename(archive)} on Node ${process.versions.node}`);

        const sourceDir = path.join(workDir, 'source');
        createSourceRepository(sourceDir);
        const env = createEnvironment(sourceDir);

        const projectDir = path.join(workDir, 'project');
        fs.mkdirSync(projectDir);
        fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"lsm-package-smoke","private":true}\n');
        runChecked(npmCommand, [
            'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive,
        ], { cwd: projectDir });

        const installed = JSON.parse(fs.readFileSync(path.join(projectDir, 'node_modules', '@wkulinski', 'lsm', 'package.json'), 'utf8'));
        const wrapper = checkInstalledPackage(projectDir, installed.version);
        checkTemplates(wrapper, workDir, env);
        checkExampleInstall(wrapper, workDir, env);
        step('package check passed');
    }
    finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

try {
    main();
}
catch (error) {
    process.stderr.write(`Package check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
