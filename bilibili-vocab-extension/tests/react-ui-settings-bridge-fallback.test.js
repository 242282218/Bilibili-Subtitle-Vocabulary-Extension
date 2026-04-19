const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SETTINGS_BRIDGE_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'settings-bridge.ts'
);

function createSettingsBridgeModule() {
  const source = fs.readFileSync(SETTINGS_BRIDGE_SOURCE_PATH, 'utf8');
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

  vm.runInNewContext(transpiled, sandbox, { filename: 'settings-bridge.js' });
  return moduleRef.exports;
}

test('react ui settings bridge fallback: should migrate legacy flat settings into v3', () => {
  const settingsBridge = createSettingsBridgeModule();

  const migrated = settingsBridge.migrateToV3({
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
    vocabularyMode: 'full',
    examPreference: 'exam-first',
    bilingualMode: 'bilingual',
    themeMode: 'dark',
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
  assert.equal(migrated.profilesCustom[0].config.bilingualMode, 'bilingual');
  assert.equal(migrated.profilesCustom[0].config.themeMode, 'dark');
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

test('react ui settings bridge fallback: should honor parent-domain rules, pauses, and disabled runtime', () => {
  const settingsBridge = createSettingsBridgeModule();
  const pausedUntil = Date.now() + 60 * 1000;
  const settings = settingsBridge.normalizeSettingsV3({
    activeProfileId: 'balanced',
    profilesBuiltin: {
      balanced: {
        enabled: true,
      },
    },
    globalControls: {
      siteRules: {
        'example.com': { enabled: false },
        'paused.dev': { enabled: true, pausedUntil },
      },
    },
  });

  const runtime = settingsBridge.resolveEffectiveRuntime(settings, 'video.example.com');

  assert.equal(runtime.siteEnabled, false);
  assert.equal(runtime.bilingualMode, 'default');
  assert.equal(runtime.themeMode, 'auto');
  assert.equal(
    settingsBridge.isDomainEnabled('nested.paused.dev', {
      enabled: true,
      domainRules: settings.globalControls.siteRules,
    }),
    false
  );
  assert.equal(
    settingsBridge.isDomainEnabled('video.example.com', {
      enabled: false,
      domainRules: {},
    }),
    false
  );
});

test('react ui settings bridge fallback: should set exact host override and clear pause when enabling site', () => {
  const settingsBridge = createSettingsBridgeModule();
  const pausedUntil = Date.now() + 60 * 1000;
  const domainRules = settingsBridge.setExactDomainRuleEnabled(
    {
      'example.com': { enabled: false },
      'video.example.com': { enabled: true, pausedUntil },
    },
    'video.example.com',
    true
  );

  assert.equal(domainRules['video.example.com'].enabled, true);
  assert.equal('pausedUntil' in domainRules['video.example.com'], false);
  assert.equal(
    settingsBridge.isDomainEnabled('video.example.com', {
      enabled: true,
      domainRules,
    }),
    true
  );
});

test('react ui settings bridge fallback: should clamp zero ratio and count instead of swallowing them', () => {
  const settingsBridge = createSettingsBridgeModule();
  const normalized = settingsBridge.normalizeSettingsV3({
    activeProfileId: 'balanced',
    profilesBuiltin: {
      balanced: {
        replaceRatio: 0,
        maxReplaceCount: 0,
      },
    },
  });

  assert.equal(normalized.profilesBuiltin.balanced.replaceRatio, 0.1);
  assert.equal(normalized.profilesBuiltin.balanced.maxReplaceCount, 1);
});

test('react ui settings bridge fallback: should retain theme mode inside normalized profile config', () => {
  const settingsBridge = createSettingsBridgeModule();
  const normalized = settingsBridge.normalizeProfileConfig({
    themeMode: 'dark',
    bilingualMode: 'english-only',
  });

  assert.equal(normalized.themeMode, 'dark');
  assert.equal(normalized.bilingualMode, 'english-only');
});

test('react ui settings bridge fallback: should parse imported settings text into a v3 snapshot', () => {
  const settingsBridge = createSettingsBridgeModule();

  const imported = settingsBridge.parseImportedSettingsText(
    JSON.stringify({
      enabled: false,
      reviewDanmakuEnabled: true,
      webPageEnabled: false,
      activeLevels: ['IELTS'],
      replaceRatio: 0.3,
      maxReplaceCount: 4,
      targetCefr: 'C1',
      reviewDanmakuSpeed: 'fast',
      vocabularyMode: 'full',
      examPreference: 'exam-first',
      bilingualMode: 'bilingual',
      themeMode: 'dark',
    })
  );

  assert.equal(imported.schemaVersion, 3);
  assert.equal(imported.activeProfileId, 'legacy-imported');
  assert.equal(imported.profilesCustom.length, 1);
  assert.equal(imported.profilesCustom[0].config.enabled, false);
  assert.equal(imported.profilesCustom[0].config.replaceRatio, 0.3);
  assert.equal(imported.profilesCustom[0].config.themeMode, 'dark');
  assert.equal(imported.globalControls.reviewDanmakuEnabled, true);
  assert.equal(imported.globalControls.webPageEnabled, false);
});

test('react ui settings bridge fallback: should return isolated reset snapshots for maintenance flows', () => {
  const settingsBridge = createSettingsBridgeModule();

  const first = settingsBridge.createResetSettingsSnapshot();
  first.activeProfileId = 'intensive';
  first.globalControls.reviewDanmakuEnabled = true;

  const second = settingsBridge.createResetSettingsSnapshot();

  assert.equal(second.schemaVersion, 3);
  assert.equal(second.activeProfileId, 'balanced');
  assert.equal(second.globalControls.reviewDanmakuEnabled, false);
});
