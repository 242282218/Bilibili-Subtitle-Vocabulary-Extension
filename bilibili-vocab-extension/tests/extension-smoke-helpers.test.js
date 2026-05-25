const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_BROWSER_EXECUTABLE_CANDIDATES,
  DEFAULT_EXTENSION_BUILD_ARTIFACTS,
  createTempRoot,
  ensureExtensionBuildExists,
  resolveBrowserExecutable,
} = require('./extension-smoke-helpers.js');

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'extension-smoke-helper-test-'));
}

function writeBuildArtifacts(workspace, artifacts = DEFAULT_EXTENSION_BUILD_ARTIFACTS) {
  artifacts.forEach((artifact) => {
    const artifactPath = path.join(workspace, artifact);
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, 'test', 'utf8');
  });
}

test('extension smoke helpers: should require the shared build artifact set', () => {
  const workspace = createWorkspace();
  try {
    writeBuildArtifacts(workspace);
    assert.doesNotThrow(() => ensureExtensionBuildExists(workspace));

    fs.rmSync(path.join(workspace, 'dist', 'overlay.js'), { force: true });
    assert.throws(() => ensureExtensionBuildExists(workspace), /Extension build artifact missing/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('extension smoke helpers: should resolve the first existing browser candidate', () => {
  const workspace = createWorkspace();
  try {
    const missingBrowser = path.join(workspace, 'missing-browser.exe');
    const existingBrowser = path.join(workspace, 'browser.exe');
    fs.writeFileSync(existingBrowser, 'test', 'utf8');

    assert.equal(resolveBrowserExecutable([missingBrowser, existingBrowser]), existingBrowser);
    assert.throws(() => resolveBrowserExecutable([missingBrowser]), /Chromium browser executable/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('extension smoke helpers: should create temp roots under the configured parent', () => {
  const workspace = createWorkspace();
  let tempRoot = '';
  try {
    tempRoot = createTempRoot('smoke-', workspace);
    assert.equal(fs.existsSync(tempRoot), true);
    assert.equal(path.dirname(tempRoot), workspace);
    assert.ok(path.basename(tempRoot).startsWith('smoke-'));
  } finally {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('extension smoke helpers: should include cross-platform browser candidates', () => {
  assert.ok(DEFAULT_BROWSER_EXECUTABLE_CANDIDATES.includes('/usr/bin/chromium'));
  assert.ok(
    DEFAULT_BROWSER_EXECUTABLE_CANDIDATES.some((candidate) =>
      candidate.endsWith('\\Microsoft\\Edge\\Application\\msedge.exe')
    )
  );
});
