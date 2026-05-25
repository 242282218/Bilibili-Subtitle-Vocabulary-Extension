const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPackageScripts() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.scripts || {};
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

function splitScriptCommands(script) {
  return normalizeScript(script)
    .split(/\s+&&\s+/)
    .map((command) => command.trim())
    .filter(Boolean);
}

function extractLocalRuntimeEntry(command) {
  const tokens = command.split(/\s+/);
  const runtime = tokens[0];

  if (runtime !== 'node' && runtime !== 'python') {
    return '';
  }

  return tokens.slice(1).find((token) => !token.startsWith('-')) || '';
}

function extractPnpmRunReference(command) {
  const tokens = command.split(/\s+/);
  if (tokens[0] !== 'pnpm' || tokens[1] !== 'run') {
    return '';
  }

  return tokens[2] || '';
}

function globHasMatches(relativePattern) {
  const normalizedPattern = relativePattern.replace(/\\/g, '/');
  const wildcardIndex = normalizedPattern.indexOf('*');
  if (wildcardIndex === -1) {
    return fs.existsSync(path.join(__dirname, '..', normalizedPattern));
  }

  const directory = normalizedPattern.slice(0, wildcardIndex).replace(/\/[^/]*$/, '');
  const filePattern = normalizedPattern.slice(directory.length + 1);
  const matcher = new RegExp(`^${filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
  return fs
    .readdirSync(path.join(__dirname, '..', directory))
    .some((fileName) => matcher.test(fileName));
}

const EXPECTED_RUNTIME_ENTRIES = [
  { scriptName: 'check:overlay-size', entry: 'scripts/check-overlay-size.js' },
  { scriptName: 'check:extension-package', entry: 'scripts/check-extension-package.js' },
  { scriptName: 'refresh:overlay-baseline', entry: 'scripts/refresh-overlay-size-baseline.js' },
  { scriptName: 'test', entry: 'tests/*.test.js' },
  { scriptName: 'test:shards', entry: 'scripts/run-continuous-optimization.js' },
  { scriptName: 'test:ui', entry: 'scripts/run-ui-tests.js' },
  { scriptName: 'test:remote:setup', entry: 'scripts/test/remote-test-machine.py' },
  { scriptName: 'test:remote:sync', entry: 'scripts/test/remote-test-machine.py' },
  { scriptName: 'test:remote:cleanup', entry: 'scripts/test/remote-test-machine.py' },
  { scriptName: 'test:remote:fixture', entry: 'scripts/test/remote-test-machine.py' },
  { scriptName: 'test:remote:real-site', entry: 'scripts/test/remote-test-machine.py' },
  { scriptName: 'test:extension-smoke:built', entry: 'tests/browser-extension-smoke.spec.js' },
  { scriptName: 'test:real-site-smoke', entry: 'tests/real-site-smoke.spec.js' },
  { scriptName: 'test:zip-smoke:built', entry: 'tests/extension-zip-smoke.spec.js' },
  { scriptName: 'test:coverage', entry: 'tests/*.test.js' },
  { scriptName: 'optimize:continuous', entry: 'scripts/run-continuous-optimization.js' },
  { scriptName: 'release:check', entry: 'scripts/run-release-candidate-checks.js' },
  { scriptName: 'release:check:real-site', entry: 'scripts/run-release-candidate-checks.js' },
  { scriptName: 'pack', entry: 'scripts/pack-extension.js' },
];

const EXPECTED_PNPM_RUN_REFERENCES = [
  { scriptName: 'build', reference: 'typecheck' },
  { scriptName: 'build:extension', reference: 'typecheck' },
  { scriptName: 'build:extension', reference: 'build:extension:bundle' },
  { scriptName: 'build:extension:bundle', reference: 'check:overlay-size' },
  { scriptName: 'test:extension-smoke', reference: 'build:extension' },
  { scriptName: 'test:extension-smoke', reference: 'test:extension-smoke:built' },
  { scriptName: 'test:real-site-smoke', reference: 'build:extension' },
  { scriptName: 'test:zip-smoke', reference: 'build:extension' },
  { scriptName: 'test:zip-smoke', reference: 'test:zip-smoke:built' },
  { scriptName: 'test:zip-smoke:built', reference: 'pack' },
];

test('build entry contract: build should run typecheck before vite build', () => {
  const scripts = readPackageScripts();
  const buildScript = normalizeScript(scripts.build);

  assert.notEqual(buildScript, '');
  assert.match(buildScript, /^pnpm run typecheck && vite build$/);
});

test('build entry contract: extension build should include typecheck and overlay budget gate', () => {
  const scripts = readPackageScripts();
  const extensionBuildScript = normalizeScript(scripts['build:extension']);
  const extensionBundleScript = normalizeScript(scripts['build:extension:bundle']);

  assert.notEqual(extensionBuildScript, '');
  assert.equal(extensionBuildScript, 'pnpm run typecheck && pnpm run build:extension:bundle');
  assert.notEqual(extensionBundleScript, '');
  assert.doesNotMatch(extensionBundleScript, /typecheck/);
  assert.match(extensionBundleScript, /vite build --config vite\.config\.mts/);
  assert.match(extensionBundleScript, /vite build --config vite\.overlay\.config\.mts/);
  assert.match(extensionBundleScript, /&& pnpm run check:overlay-size$/);
});

test('build entry contract: pack should use node pack script', () => {
  const scripts = readPackageScripts();
  const packScript = normalizeScript(scripts.pack);

  assert.notEqual(packScript, '');
  assert.match(packScript, /^node scripts\/pack-extension\.js$/);
});

test('build entry contract: package runtime commands should reference existing local entries', () => {
  const scripts = readPackageScripts();
  const runtimeEntries = [];

  for (const [scriptName, script] of Object.entries(scripts)) {
    for (const command of splitScriptCommands(script)) {
      const entry = extractLocalRuntimeEntry(command);
      if (entry) {
        runtimeEntries.push({ scriptName, entry });
      }
    }
  }

  assert.deepEqual(runtimeEntries, EXPECTED_RUNTIME_ENTRIES);
  for (const { scriptName, entry } of runtimeEntries) {
    assert.equal(globHasMatches(entry), true, `${scriptName} references missing entry: ${entry}`);
  }
});

test('build entry contract: package script references should target existing scripts', () => {
  const scripts = readPackageScripts();
  const scriptNames = new Set(Object.keys(scripts));
  const references = [];

  for (const [scriptName, script] of Object.entries(scripts)) {
    for (const command of splitScriptCommands(script)) {
      const reference = extractPnpmRunReference(command);
      if (reference) {
        references.push({ scriptName, reference });
      }
    }
  }

  assert.deepEqual(references, EXPECTED_PNPM_RUN_REFERENCES);
  for (const { scriptName, reference } of references) {
    assert.equal(
      scriptNames.has(reference),
      true,
      `${scriptName} references missing script: ${reference}`
    );
  }
});

test('build entry contract: extension smoke should build first and then delegate to built test', () => {
  const scripts = readPackageScripts();
  const smokeScript = normalizeScript(scripts['test:extension-smoke']);
  const builtSmokeScript = normalizeScript(scripts['test:extension-smoke:built']);

  assert.notEqual(smokeScript, '');
  assert.equal(smokeScript, 'pnpm run build:extension && pnpm run test:extension-smoke:built');
  assert.equal(builtSmokeScript, 'node --test tests/browser-extension-smoke.spec.js');
  assert.doesNotMatch(builtSmokeScript, /build:extension/);
});

test('build entry contract: ci should use build-extension as the release build gate', () => {
  const workflow = readWorkflow('ci.yml');

  assert.doesNotMatch(workflow, /^  build-react-ui:\r?$/m);
  assert.match(workflow, /^  build-extension:\r?$/m);
  assert.match(workflow, /build-extension:[\s\S]*run: pnpm run build:extension/);
});
