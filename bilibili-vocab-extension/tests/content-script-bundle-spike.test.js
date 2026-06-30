const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('content script bundle spike: should exist without replacing manifest runtime files', () => {
  const root = path.join(__dirname, '..');
  const spikeConfigPath = path.join(root, 'vite.content-script-spike.config.mts');
  const spikeEntryPath = path.join(root, 'contentScriptBundleSpike.entry.mjs');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')
  );
  const shippedEntry = manifest.content_scripts.find((entry) => Array.isArray(entry.js));

  assert.equal(fs.existsSync(spikeConfigPath), true);
  assert.equal(fs.existsSync(spikeEntryPath), true);
  assert.equal(shippedEntry.js.includes('dist-spike/content-script.bundle.js'), false);
  assert.equal(shippedEntry.js.includes('contentScript/index.js'), true);
});

test('content script bundle spike: static imports should target existing files', () => {
  const root = path.join(__dirname, '..');
  const spikeEntryPath = path.join(root, 'contentScriptBundleSpike.entry.mjs');
  const source = fs.readFileSync(spikeEntryPath, 'utf8');
  const localImports = Array.from(source.matchAll(/^\s*import\s+['"](\.\/[^'"]+)['"];?$/gm)).map(
    (match) => match[1]
  );

  assert.equal(localImports.includes('./contentScript.js'), false);
  for (const importPath of localImports) {
    assert.equal(
      fs.existsSync(path.join(root, importPath)),
      true,
      `Missing spike import target: ${importPath}`
    );
  }
});

test('critical content script runtime types: should document cross-module contracts', () => {
  const typesPath = path.join(__dirname, '..', 'content-script-runtime.d.ts');
  const source = fs.readFileSync(typesPath, 'utf8');

  for (const exportedType of [
    'BiliVocabRuntimeSettings',
    'BiliVocabSubtitleItem',
    'BiliVocabSubtitleNavigationState',
    'BiliVocabLearningHit',
    'BiliVocabSiteAdapterResult',
  ]) {
    assert.match(source, new RegExp(`export interface ${exportedType}`));
  }
});

test('runtime entries: should use React dist entries', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')
  );
  const contentScriptEntry = manifest.content_scripts.find((entry) => Array.isArray(entry.js));
  const webAccessibleResources = manifest.web_accessible_resources.flatMap((entry) =>
    Array.isArray(entry.resources) ? entry.resources : []
  );

  assert.equal(manifest.action.default_popup, 'dist/popup.html');
  assert.equal(manifest.options_page, 'dist/options.html');
  assert.equal(webAccessibleResources.includes('dist/overlay.js'), true);
  assert.equal(contentScriptEntry.js.includes('overlayPanel.js'), false);
});
