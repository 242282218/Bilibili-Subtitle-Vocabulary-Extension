const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPackageScripts() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.scripts || {};
}

function normalizeScript(script) {
  return String(script || '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('test coverage entry contract: should use node test coverage runner', () => {
  const scripts = readPackageScripts();
  const coverageScript = normalizeScript(scripts['test:coverage']);

  assert.notEqual(coverageScript, '');
  assert.doesNotMatch(coverageScript, /\bvitest\b/);
  assert.match(coverageScript, /(?:^|\s)node\s+--test\b/);
  assert.match(coverageScript, /--experimental-test-coverage\b/);
});

test('test coverage entry contract: should target repository node test files', () => {
  const scripts = readPackageScripts();
  const coverageScript = normalizeScript(scripts['test:coverage']);

  assert.match(coverageScript, /tests\/\*\.test\.js\b/);
});

test('test coverage entry contract: should keep build-dependent smoke specs out of coverage', () => {
  const scripts = readPackageScripts();
  const coverageScript = normalizeScript(scripts['test:coverage']);
  const buildDependentSmokeSpecs = [
    'browser-extension-smoke.spec.js',
    'extension-zip-smoke.spec.js',
    'real-site-smoke.spec.js',
  ];

  assert.doesNotMatch(coverageScript, /tests\/\*\.spec\.js\b/);
  for (const fileName of buildDependentSmokeSpecs) {
    assert.equal(fs.existsSync(path.join(__dirname, fileName)), true);
    assert.doesNotMatch(path.basename(fileName), /\.test\.js$/);
    assert.doesNotMatch(coverageScript, new RegExp(fileName.replaceAll('.', '\\.')));
  }
});
