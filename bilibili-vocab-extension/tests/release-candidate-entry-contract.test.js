const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RELEASE_CHECK_SCRIPT_NAMES,
  REMOTE_REAL_SITE_SCRIPT_NAME,
  createSpawnSpec,
  createReleaseCheckSteps,
  parseCliArgs,
  runReleaseChecks,
  shouldIncludeRemoteRealSite,
} = require('../scripts/run-release-candidate-checks.js');

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
}

function readWorkflow(fileName) {
  return fs
    .readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', fileName), 'utf8')
    .replace(/\r\n/g, '\n');
}

function readWorkflowJob(fileName, jobName) {
  const workflow = readWorkflow(fileName);
  const marker = `\n  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing workflow job: ${jobName}`);

  const rest = workflow.slice(start + marker.length);
  const nextJobMatch = rest.match(/\n  [a-zA-Z0-9_-]+:\n/);
  return nextJobMatch ? rest.slice(0, nextJobMatch.index) : rest;
}

function readTestFile(fileName) {
  return fs.readFileSync(path.join(__dirname, fileName), 'utf8').replace(/\r\n/g, '\n');
}

function normalizeScript(script) {
  return String(script || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPackageManagerPnpmVersion(packageJson) {
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(String(packageJson.packageManager || ''));
  assert.ok(match, `Expected packageManager to pin pnpm semver, got ${packageJson.packageManager}`);
  return match[1];
}

const EXPECTED_RELEASE_CHECK_SCRIPT_NAMES = [
  'lint',
  'typecheck',
  'test',
  'test:ui',
  'build:extension:bundle',
  'test:extension-smoke:built',
  'test:zip-smoke:built',
];

test('release candidate contract: package should expose serial release and zip smoke scripts', () => {
  const packageJson = readPackageJson();
  const scripts = packageJson.scripts || {};

  assert.equal(getPackageManagerPnpmVersion(packageJson), '9.15.9');
  assert.equal(
    normalizeScript(scripts['release:check']),
    'node scripts/run-release-candidate-checks.js'
  );
  assert.equal(
    normalizeScript(scripts['release:check:real-site']),
    'node scripts/run-release-candidate-checks.js --include-remote-real-site'
  );
  assert.equal(Object.prototype.hasOwnProperty.call(scripts, 'optimize:continuous:release'), false);
  assert.equal(
    normalizeScript(scripts['test:extension-smoke']),
    'pnpm run build:extension && pnpm run test:extension-smoke:built'
  );
  assert.equal(
    normalizeScript(scripts['test:extension-smoke:built']),
    'node --test tests/browser-extension-smoke.spec.js'
  );
  assert.equal(
    normalizeScript(scripts['check:extension-package']),
    'node scripts/check-extension-package.js'
  );
  assert.equal(
    normalizeScript(scripts['build:extension:bundle']),
    'vite build --config vite.config.mts && vite build --config vite.overlay.config.mts && pnpm run check:overlay-size'
  );
  assert.equal(
    normalizeScript(scripts['test:zip-smoke']),
    'pnpm run build:extension && pnpm run test:zip-smoke:built'
  );
  assert.equal(
    normalizeScript(scripts['test:zip-smoke:built']),
    'pnpm run pack && node --test tests/extension-zip-smoke.spec.js'
  );
  assert.doesNotMatch(normalizeScript(scripts['test:extension-smoke:built']), /build:extension/);
  assert.doesNotMatch(normalizeScript(scripts['test:zip-smoke:built']), /build:extension/);
});

test('release candidate contract: runner should keep build-dependent smoke tests out of default node test glob', () => {
  const browserSmokePath = path.join(__dirname, 'browser-extension-smoke.spec.js');
  const zipSmokePath = path.join(__dirname, 'extension-zip-smoke.spec.js');
  const realSiteSmokePath = path.join(__dirname, 'real-site-smoke.spec.js');
  const packageJson = readPackageJson();
  const defaultTestScript = normalizeScript(packageJson.scripts && packageJson.scripts.test);

  assert.equal(fs.existsSync(browserSmokePath), true);
  assert.equal(fs.existsSync(zipSmokePath), true);
  assert.equal(fs.existsSync(realSiteSmokePath), true);
  assert.match(defaultTestScript, /node --test tests\/\*\.test\.js/);
  assert.doesNotMatch(path.basename(browserSmokePath), /\.test\.js$/);
  assert.doesNotMatch(path.basename(zipSmokePath), /\.test\.js$/);
  assert.doesNotMatch(path.basename(realSiteSmokePath), /\.test\.js$/);
});

test('release candidate contract: zip smoke should delegate package policy to package gate', () => {
  const zipSmokeSource = readTestFile('extension-zip-smoke.spec.js');
  const packageJson = readPackageJson();
  const scripts = packageJson.scripts || {};

  assert.match(zipSmokeSource, /runExtensionPackageCheck/);
  assert.match(zipSmokeSource, /report\.result\.overall/);
  assert.match(zipSmokeSource, /require\('\.\/extension-smoke-helpers\.js'\)/);
  assert.doesNotMatch(normalizeScript(scripts['test:zip-smoke:built']), /check:extension-package/);
  assert.doesNotMatch(zipSmokeSource, /\brequiredPaths\b/);
  assert.doesNotMatch(zipSmokeSource, /\bforbiddenPaths\b/);
  assert.doesNotMatch(zipSmokeSource, /\bEDGE_EXECUTABLE_CANDIDATES\b/);
  assert.doesNotMatch(zipSmokeSource, /\bTEMP_ROOT_PARENT\b/);
  assert.doesNotMatch(zipSmokeSource, /function\s+resolveBrowserExecutable\b/);
  assert.doesNotMatch(zipSmokeSource, /function\s+createTempRoot\b/);
});

test('release candidate contract: runner should execute required scripts serially', () => {
  const packageJson = readPackageJson();
  const scripts = packageJson.scripts || {};
  const steps = createReleaseCheckSteps({ platform: 'linux', pnpmCommand: 'pnpm' });

  assert.deepEqual(RELEASE_CHECK_SCRIPT_NAMES, EXPECTED_RELEASE_CHECK_SCRIPT_NAMES);
  assert.deepEqual(
    steps.map((step) => step.id),
    EXPECTED_RELEASE_CHECK_SCRIPT_NAMES
  );
  for (const scriptName of RELEASE_CHECK_SCRIPT_NAMES.concat(REMOTE_REAL_SITE_SCRIPT_NAME)) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(scripts, scriptName),
      true,
      `Missing package script for release step: ${scriptName}`
    );
  }
  assert.deepEqual(steps[0], {
    id: 'lint',
    title: 'lint',
    command: 'pnpm',
    args: ['run', 'lint'],
  });
  assert.equal(steps[3].id, 'test:ui');
  assert.equal(
    steps.some((step) => step.id === 'optimize:continuous:release'),
    false
  );
  assert.equal(steps.at(-3).id, 'build:extension:bundle');
  assert.equal(steps.at(-2).id, 'test:extension-smoke:built');
  assert.equal(steps.at(-1).id, 'test:zip-smoke:built');
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
  assert.equal(
    shouldIncludeRemoteRealSite({ env: { RELEASE_CHECK_INCLUDE_REMOTE_REAL_SITE: '1' } }),
    true
  );
  assert.equal(
    shouldIncludeRemoteRealSite({ env: { RELEASE_CHECK_INCLUDE_REMOTE_REAL_SITE: ' true ' } }),
    true
  );
  assert.equal(
    shouldIncludeRemoteRealSite({ env: { RELEASE_CHECK_INCLUDE_REMOTE_REAL_SITE: 'YES' } }),
    true
  );
  assert.equal(
    shouldIncludeRemoteRealSite({ env: { RELEASE_CHECK_INCLUDE_REMOTE_REAL_SITE: '0' } }),
    false
  );
  assert.equal(
    shouldIncludeRemoteRealSite({
      includeRemoteRealSite: false,
      env: { RELEASE_CHECK_INCLUDE_REMOTE_REAL_SITE: 'true' },
    }),
    false
  );
});

test('release candidate contract: cli args should reject unknown options', () => {
  assert.deepEqual(parseCliArgs([]), {
    includeRemoteRealSite: undefined,
  });
  assert.deepEqual(parseCliArgs(['--include-remote-real-site']), {
    includeRemoteRealSite: true,
  });
  assert.throws(() => parseCliArgs(['--include-real-site']), /Unknown release check option/);
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
  const pnpmVersion = escapeRegExp(getPackageManagerPnpmVersion(readPackageJson()));
  const versionPattern = new RegExp(`PNPM_VERSION:\\s*"${pnpmVersion}"`);

  assert.match(readWorkflow('ci.yml'), versionPattern);
  assert.match(readWorkflow('overlay-baseline-refresh.yml'), versionPattern);
});

test('release candidate contract: windows package job should run smoke and upload diagnostic reports', () => {
  const workflow = readWorkflowJob('ci.yml', 'pack-windows-smoke');

  assert.match(workflow, /name: Run extension browser smoke/);
  assert.match(workflow, /run: pnpm run test:extension-smoke:built/);
  assert.doesNotMatch(workflow, /run: pnpm run test:extension-smoke\r?$/m);
  assert.match(workflow, /name: Check Extension Package/);
  assert.match(workflow, /run: pnpm run check:extension-package/);
  assert.match(workflow, /name: Run extension zip smoke/);
  assert.match(workflow, /run: pnpm run test:zip-smoke:built/);
  assert.doesNotMatch(workflow, /name: Verify extension\.zip exists/);
  assert.match(
    workflow,
    /name: Upload extension package\s+if: \$\{\{\s*always\(\)\s*&&\s*hashFiles\('bilibili-vocab-extension\/extension\.zip'\)\s*!=\s*''\s*\}\}/
  );
  assert.match(
    workflow,
    /name: Upload overlay size report\s+if: always\(\)\s+uses: actions\/upload-artifact@v4\s+with:\s+name: overlay-size-report-windows\s+path: \$\{\{\s*env\.WORKDIR\s*\}\}\/dist\/overlay-size-report\.json\s+if-no-files-found: warn/
  );
  assert.match(workflow, /name: extension-package-report-windows/);
  assert.match(workflow, /path: \$\{\{\s*env\.WORKDIR\s*\}\}\/test-results\/extension-package/);
});

test('release candidate contract: linux build job should run package gate', () => {
  const workflow = readWorkflowJob('ci.yml', 'build-extension');

  assert.match(workflow, /name: Build Extension Bundle/);
  assert.match(workflow, /name: Pack Extension/);
  assert.match(workflow, /run: pnpm run pack/);
  assert.match(workflow, /name: Check Extension Package/);
  assert.match(workflow, /run: pnpm run check:extension-package/);
  assert.match(workflow, /name: Run extension zip smoke/);
  assert.match(workflow, /run: pnpm run test:zip-smoke:built/);
  assert.match(
    workflow,
    /name: Upload overlay size report\s+if: always\(\)\s+uses: actions\/upload-artifact@v4\s+with:\s+name: overlay-size-report-linux\s+path: \$\{\{\s*env\.WORKDIR\s*\}\}\/dist\/overlay-size-report\.json\s+if-no-files-found: warn/
  );
  assert.match(
    workflow,
    /name: Upload extension package\s+if: \$\{\{\s*always\(\)\s*&&\s*hashFiles\('bilibili-vocab-extension\/extension\.zip'\)\s*!=\s*''\s*\}\}/
  );
  assert.match(workflow, /name: extension-package-linux/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /name: extension-package-report-linux/);
  assert.match(workflow, /path: \$\{\{\s*env\.WORKDIR\s*\}\}\/test-results\/extension-package/);
});
