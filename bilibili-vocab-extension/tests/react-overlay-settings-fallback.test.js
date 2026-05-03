const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const OVERLAY_SETTINGS_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'overlay-settings.ts'
);

function createOverlaySettingsModule() {
  const source = fs.readFileSync(OVERLAY_SETTINGS_SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleRef = { exports: {} };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require,
    window: {},
    console,
    Date,
    JSON,
    Math,
    Promise,
    Set,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox.window;

  vm.runInNewContext(transpiled, sandbox, { filename: 'overlay-settings.js' });
  return moduleRef.exports;
}

test('react overlay settings fallback: should migrate legacy flat settings into v3', () => {
  const overlaySettings = createOverlaySettingsModule();

  const migrated = overlaySettings.migrateToV3({
    enabled: false,
    reviewDanmakuEnabled: true,
    webPageEnabled: false,
    domainRules: {
      'docs.example.com': { enabled: false },
    },
    activeLevels: ['IELTS'],
    replaceRatio: 0.3,
    maxReplaceCount: 4,
    targetCefr: 'C1',
    reviewDanmakuSpeed: 'fast',
    reviewDanmakuDensity: 'dense',
    vocabularyMode: 'full',
    examPreference: 'exam-first',
    overlayPanelHidden: true,
    overlayPanelCollapsed: true,
    overlayPanelWidth: 500,
    overlayPanelHeight: 700,
    overlayPanelOffsetRight: 80,
    overlayPanelOffsetBottom: 120,
  });

  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.activeProfileId, 'legacy-imported');
  assert.equal(migrated.profilesCustom.length, 1);
  assert.equal(migrated.profilesCustom[0].id, 'legacy-imported');
  assert.equal(migrated.profilesCustom[0].config.enabled, false);
  assert.equal(migrated.profilesCustom[0].config.replaceRatio, 0.3);
  assert.equal(migrated.profilesCustom[0].config.maxReplaceCount, 4);
  assert.equal(migrated.profilesCustom[0].config.reviewDanmakuDensity, 'dense');
  assert.deepEqual(Array.from(migrated.profilesCustom[0].config.activeLevels), ['IELTS']);
  assert.equal(migrated.globalControls.reviewDanmakuEnabled, true);
  assert.equal(migrated.globalControls.webPageEnabled, false);
  assert.equal(migrated.globalControls.siteRules['docs.example.com'].enabled, false);
  assert.equal(migrated.globalControls.overlayState.hidden, true);
  assert.equal(migrated.globalControls.overlayState.collapsed, true);
  assert.equal(migrated.globalControls.overlayState.width, 500);
  assert.equal(migrated.globalControls.overlayState.height, 700);
  assert.equal(migrated.globalControls.overlayState.offsetRight, 80);
  assert.equal(migrated.globalControls.overlayState.offsetBottom, 120);
});
