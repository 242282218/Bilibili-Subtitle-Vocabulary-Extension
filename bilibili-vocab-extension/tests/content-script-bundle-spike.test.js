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
  assert.equal(shippedEntry.js.includes('contentScript.js'), true);
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

test('legacy runtime entries: should remain explicit and outside shipped React entries', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')
  );
  const legacyEntries = [
    { fileName: 'popup.js', shippedEntry: manifest.action.default_popup },
    { fileName: 'options.js', shippedEntry: manifest.options_page },
    { fileName: 'overlayPanel.js', shippedEntry: 'dist/overlay.js' },
  ];
  const contentScriptEntry = manifest.content_scripts.find((entry) => Array.isArray(entry.js));
  const webAccessibleResources = manifest.web_accessible_resources.flatMap((entry) =>
    Array.isArray(entry.resources) ? entry.resources : []
  );

  assert.equal(manifest.action.default_popup, 'dist/popup.html');
  assert.equal(manifest.options_page, 'dist/options.html');
  assert.equal(webAccessibleResources.includes('dist/overlay.js'), true);
  assert.equal(contentScriptEntry.js.includes('overlayPanel.js'), false);

  for (const { fileName, shippedEntry } of legacyEntries) {
    const source = fs.readFileSync(path.join(root, fileName), 'utf8');

    assert.match(source, /@legacy/);
    assert.equal(shippedEntry.includes(fileName), false);
  }
});
