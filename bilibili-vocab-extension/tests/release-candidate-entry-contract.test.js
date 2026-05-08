const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RELEASE_CHECK_SCRIPT_NAMES,
  REMOTE_REAL_SITE_SCRIPT_NAME,
  createSpawnSpec,
  createReleaseCheckSteps,
  runReleaseChecks,
  shouldIncludeRemoteRealSite,
} = require('../scripts/run-release-candidate-checks.js');

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
}

function readWorkflow(fileName) {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', fileName),
    'utf8'
  );
}

function normalizeScript(script) {
  return String(script || '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('release candidate contract: package should expose serial release and zip smoke scripts', () => {
  const packageJson = readPackageJson();
  const scripts = packageJson.scripts || {};

  assert.equal(packageJson.packageManager, 'pnpm@9.15.9');
  assert.equal(
    normalizeScript(scripts['release:check']),
    'node scripts/run-release-candidate-checks.js'
  );
  assert.equal(
    normalizeScript(scripts['release:check:real-site']),
    'node scripts/run-release-candidate-checks.js --include-remote-real-site'
  );
  assert.equal(
    normalizeScript(scripts['test:extension-smoke']),
    'pnpm run build:extension && node --test tests/browser-extension-smoke.spec.js'
  );
  assert.equal(
    normalizeScript(scripts['test:zip-smoke']),
    'pnpm run pack && node --test tests/extension-zip-smoke.spec.js'
  );
});

test('release candidate contract: runner should keep build-dependent smoke tests out of default node test glob', () => {
  const browserSmokePath = path.join(__dirname, 'browser-extension-smoke.spec.js');
  const zipSmokePath = path.join(__dirname, 'extension-zip-smoke.spec.js');
  const packageJson = readPackageJson();
  const defaultTestScript = normalizeScript(packageJson.scripts && packageJson.scripts.test);

  assert.equal(fs.existsSync(browserSmokePath), true);
  assert.equal(fs.existsSync(zipSmokePath), true);
  assert.match(defaultTestScript, /node --test tests\/\*\.test\.js/);
  assert.doesNotMatch(path.basename(browserSmokePath), /\.test\.js$/);
  assert.doesNotMatch(path.basename(zipSmokePath), /\.test\.js$/);
});

test('release candidate contract: runner should execute required scripts serially', () => {
  const steps = createReleaseCheckSteps({ platform: 'linux', pnpmCommand: 'pnpm' });
  assert.deepEqual(
    steps.map((step) => step.id),
    RELEASE_CHECK_SCRIPT_NAMES
  );
  assert.deepEqual(steps[0], {
    id: 'lint',
    title: 'lint',
    command: 'pnpm',
    args: ['run', 'lint'],
  });
  assert.equal(steps.at(-1).id, 'test:zip-smoke');
});

test('release candidate contract: runner should expose explicit real-site gate', () => {
  const steps = createReleaseCheckSteps({
    platform: 'linux',
    pnpmCommand: 'pnpm',
    includeRemoteRealSite: true,
  });

  assert.equal(REMOTE_REAL_SITE_SCRIPT_NAME, 'test:remote:real-site');
  assert.equal(steps.at(-1).id, 'test:remote:real-site');
  assert.deepEqual(steps.at(-1), {
    id: 'test:remote:real-site',
    title: 'test:remote:real-site',
    command: 'pnpm',
    args: ['run', 'test:remote:real-site'],
  });
  assert.equal(shouldIncludeRemoteRealSite({ includeRemoteRealSite: true }), true);
  assert.equal(shouldIncludeRemoteRealSite({ includeRemoteRealSite: false }), false);
});

test('release candidate contract: runner should stop on first failed step', () => {
  const calls = [];
  assert.throws(
    () =>
      runReleaseChecks({
        stdio: 'pipe',
        steps: [
          { id: 'lint', title: 'lint', command: 'pnpm', args: ['run', 'lint'] },
          { id: 'typecheck', title: 'typecheck', command: 'pnpm', args: ['run', 'typecheck'] },
          { id: 'test', title: 'test', command: 'pnpm', args: ['run', 'test'] },
        ],
        runner(command, args) {
          calls.push([command, ...args].join(' '));
          return { status: calls.length === 2 ? 1 : 0 };
        },
      }),
    /typecheck failed/
  );

  assert.deepEqual(calls, ['pnpm run lint', 'pnpm run typecheck']);
});

test('release candidate contract: runner should use shell for windows pnpm cmd wrappers', () => {
  assert.deepEqual(createSpawnSpec('pnpm.cmd', ['run', 'lint'], { platform: 'win32' }), {
    command: 'pnpm.cmd run lint',
    args: [],
    shell: true,
  });
  assert.deepEqual(createSpawnSpec('pnpm', ['run', 'lint'], { platform: 'linux' }), {
    command: 'pnpm',
    args: ['run', 'lint'],
    shell: false,
  });
});

test('release candidate contract: workflows should pin pnpm to packageManager version', () => {
  assert.match(readWorkflow('ci.yml'), /PNPM_VERSION:\s*"9\.15\.9"/);
  assert.match(readWorkflow('overlay-baseline-refresh.yml'), /PNPM_VERSION:\s*"9\.15\.9"/);
});
