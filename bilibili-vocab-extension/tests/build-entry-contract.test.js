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

test('build entry contract: build should run typecheck before vite build', () => {
  const scripts = readPackageScripts();
  const buildScript = normalizeScript(scripts.build);

  assert.notEqual(buildScript, '');
  assert.match(buildScript, /^pnpm run typecheck && vite build$/);
});

test('build entry contract: extension build should include typecheck and overlay budget gate', () => {
  const scripts = readPackageScripts();
  const extensionBuildScript = normalizeScript(scripts['build:extension']);

  assert.notEqual(extensionBuildScript, '');
  assert.match(extensionBuildScript, /^pnpm run typecheck &&/);
  assert.match(extensionBuildScript, /vite build --config vite\.config\.mts/);
  assert.match(extensionBuildScript, /vite build --config vite\.overlay\.config\.mts/);
  assert.match(extensionBuildScript, /&& pnpm run check:overlay-size$/);
});

test('build entry contract: pack should use node pack script', () => {
  const scripts = readPackageScripts();
  const packScript = normalizeScript(scripts.pack);

  assert.notEqual(packScript, '');
  assert.match(packScript, /^node scripts\/pack-extension\.js$/);
});
