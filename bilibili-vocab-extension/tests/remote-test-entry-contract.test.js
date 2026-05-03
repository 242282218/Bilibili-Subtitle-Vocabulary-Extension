const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const SCRIPT_ROOT = path.join(PROJECT_ROOT, 'scripts', 'test');
const RUNNER_PATH = path.join(SCRIPT_ROOT, 'remote-test-machine.py');
const EXPECTED_REMOTE_SCRIPTS = [
  '00-setup-remote-env.sh',
  '10-sync-workspace.sh',
  '20-run-fixture-e2e.sh',
  '30-run-real-site-smoke.sh',
  '40-run-long-session.sh',
  '90-cleanup-remote.sh',
];

function readPackageScripts() {
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.scripts || {};
}

function readScript(fileName) {
  return fs.readFileSync(path.join(SCRIPT_ROOT, fileName), 'utf8');
}

function normalizeScript(script) {
  return String(script || '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('remote test entry contract: package should expose remote test-machine commands', () => {
  const scripts = readPackageScripts();

  assert.equal(
    normalizeScript(scripts['test:remote:setup']),
    'python scripts/test/remote-test-machine.py setup'
  );
  assert.equal(
    normalizeScript(scripts['test:remote:sync']),
    'python scripts/test/remote-test-machine.py sync'
  );
  assert.equal(
    normalizeScript(scripts['test:remote:cleanup']),
    'python scripts/test/remote-test-machine.py cleanup'
  );
  assert.equal(
    normalizeScript(scripts['test:remote:fixture']),
    'python scripts/test/remote-test-machine.py fixture'
  );
  assert.equal(
    normalizeScript(scripts['test:remote:real-site']),
    'python scripts/test/remote-test-machine.py real-site'
  );
  assert.equal(
    normalizeScript(scripts['test:remote:long-run']),
    'python scripts/test/remote-test-machine.py long-run'
  );
});

test('remote test entry contract: scripts/test should include the phase-0 baseline scripts', () => {
  const scriptNames = fs.readdirSync(SCRIPT_ROOT).sort();

  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    assert.equal(scriptNames.includes(fileName), true, `${fileName} should exist`);
  });
  assert.equal(fs.existsSync(RUNNER_PATH), true);
});

test('remote test entry contract: shell scripts should log required artifacts and run in strict bash mode', () => {
  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    const content = readScript(fileName);
    assert.match(content, /^#!\/usr\/bin\/env bash/m);
    assert.match(content, /set -Eeuo pipefail/);
    assert.match(content, /command\.txt/);
    assert.match(content, /stdout\.log/);
    assert.match(content, /stderr\.log/);
    assert.match(content, /summary\.txt/);
    assert.match(content, /status=PASS|status=%s/);
  });
});

test('remote test entry contract: fixture runner should keep browser smoke in explicit out-of-band entry', () => {
  const packageScripts = readPackageScripts();

  assert.equal(
    normalizeScript(packageScripts['test:extension-smoke']),
    'pnpm run build:extension && node --test tests/browser-extension-smoke.spec.js'
  );
});

test('remote test entry contract: real-site runner should execute the shipped live-site smoke spec', () => {
  const scriptContent = readScript('30-run-real-site-smoke.sh');

  assert.equal(
    fs.existsSync(path.join(PROJECT_ROOT, 'tests', 'real-site-smoke.spec.js')),
    true,
    'real-site smoke spec should exist'
  );
  assert.doesNotMatch(scriptContent, /exit 64/);
  assert.match(scriptContent, /tests\/real-site-smoke\.spec\.js/);
});

test('remote test entry contract: python runner should describe action-to-script mapping', () => {
  const output = execFileSync('python', [RUNNER_PATH, '--describe'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });
  const description = JSON.parse(output);

  assert.deepEqual(description.actions, [
    'setup',
    'sync',
    'fixture',
    'real-site',
    'long-run',
    'cleanup',
  ]);
  assert.equal(description.remote_scripts.setup, '00-setup-remote-env.sh');
  assert.equal(description.remote_scripts.sync, '10-sync-workspace.sh');
  assert.equal(description.remote_scripts.fixture, '20-run-fixture-e2e.sh');
  assert.equal(description.defaults.remote_root, '/root/bilibili-vocab-extension');
  assert.equal(description.defaults.phase, 'phase-0');
  assert.equal(description.defaults.task_card, 'P0-TEST-BOOTSTRAP');
});
