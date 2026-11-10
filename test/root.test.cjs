'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { projectRoot } = require('../lib/root.cjs');

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-root-')));
const git = (...args) => execFileSync('git', args, { cwd: tmp, stdio: 'ignore' });
git('init', '-q', '-b', 'main');
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
git('worktree', 'add', '-q', '.worktrees/a', '-b', 'a');

// Mismo formato que path.resolve: el lanzador compara con startsWith.
assert.equal(projectRoot(tmp), path.resolve(tmp));
assert.equal(projectRoot(path.join(tmp, '.worktrees', 'a')), path.resolve(tmp));
assert.ok(path.resolve(tmp, '.worktrees/a').startsWith(projectRoot(tmp)));
const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-nogit-')));
assert.equal(projectRoot(outside), path.resolve(outside));
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
console.log('root: 4 passed, 0 failed.');
