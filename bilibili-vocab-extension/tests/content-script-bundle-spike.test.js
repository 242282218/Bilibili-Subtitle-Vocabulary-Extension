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

test('legacy removal plan: should keep deletion gated from feature work', () => {
  const planPath = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'plans',
    '2026-05-02-legacy-removal-plan.md'
  );
  const source = fs.readFileSync(planPath, 'utf8');

  assert.match(source, /popup\.js/);
  assert.match(source, /options\.js/);
  assert.match(source, /overlayPanel\.js/);
  assert.match(source, /删除必须单独成 PR \/ commit/);
});
