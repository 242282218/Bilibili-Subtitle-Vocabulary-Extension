const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_EXTENSION_BUILD_ARTIFACTS = [
  'manifest.json',
  'dist/options.html',
  'dist/popup.html',
  'dist/overlay.js',
];
const DEFAULT_BROWSER_EXECUTABLE_CANDIDATES = [
  process.env.BILI_VOCAB_EXTENSION_BROWSER,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function ensureExtensionBuildExists(
  projectRoot,
  requiredArtifacts = DEFAULT_EXTENSION_BUILD_ARTIFACTS
) {
  for (const artifact of requiredArtifacts) {
    const artifactPath = path.resolve(projectRoot, artifact);
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Extension build artifact missing: ${artifactPath}`);
    }
  }
}

function resolveBrowserExecutable(candidates = DEFAULT_BROWSER_EXECUTABLE_CANDIDATES) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Chromium browser executable not found. Checked: ${candidates.join(', ')}`);
}

function createTempRoot(
  prefix,
  tempRootParent = process.env.BILI_VOCAB_EXTENSION_TMPDIR || os.tmpdir()
) {
  // Why: snap-packaged Chromium can reject extension assets under sandboxed temp roots.
  fs.mkdirSync(tempRootParent, { recursive: true });
  return fs.mkdtempSync(path.join(tempRootParent, prefix));
}

module.exports = {
  DEFAULT_BROWSER_EXECUTABLE_CANDIDATES,
  DEFAULT_EXTENSION_BUILD_ARTIFACTS,
  createTempRoot,
  ensureExtensionBuildExists,
  resolveBrowserExecutable,
};
