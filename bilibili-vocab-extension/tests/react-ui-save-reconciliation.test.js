const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const modulePath = path.join(__dirname, '..', 'react-ui', 'src', 'use-v3-settings.ts');
const moduleDir = path.dirname(modulePath);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSettings(overrides = {}) {
  const base = {
    schemaVersion: 3,
    activeProfileId: 'balanced',
    profilesBuiltin: {
      gentle: {
        enabled: true,
        replaceRatio: 0.15,
        maxReplaceCount: 1,
        targetCefr: 'B2',
        activeLevels: ['CET4', 'CET6'],
        reviewDanmakuSpeed: 'slow',
        vocabularyMode: 'core',
        examPreference: 'balanced',
      },
      balanced: {
        enabled: true,
        replaceRatio: 0.2,
        maxReplaceCount: 2,
        targetCefr: 'B2',
        activeLevels: ['CET4', 'CET6'],
        reviewDanmakuSpeed: 'normal',
        vocabularyMode: 'core',
        examPreference: 'balanced',
      },
      intensive: {
        enabled: true,
        replaceRatio: 0.3,
        maxReplaceCount: 4,
        targetCefr: 'B2',
        activeLevels: ['CET4', 'CET6'],
        reviewDanmakuSpeed: 'fast',
        vocabularyMode: 'core',
        examPreference: 'balanced',
      },
    },
    profilesCustom: [],
    globalControls: {
      reviewDanmakuEnabled: false,
      webPageEnabled: true,
      siteRules: {},
      overlayState: {
        hidden: false,
        collapsed: false,
        width: 420,
        height: 640,
        offsetRight: 24,
        offsetBottom: 96,
      },
    },
  };

  return {
    ...base,
    ...clone(overrides),
    profilesBuiltin: {
      ...base.profilesBuiltin,
      ...(overrides.profilesBuiltin || {}),
    },
    globalControls: {
      ...base.globalControls,
      ...(overrides.globalControls || {}),
    },
  };
}

function loadModule() {
  const source = fs.readFileSync(modulePath, 'utf8');
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
    require(id) {
      if (id === 'react') {
        return require('react');
      }
      if (id === './settings-bridge') {
        return {
          cloneSettingsV3: clone,
          normalizeSettingsV3: clone,
        };
      }
      if (id === './storage') {
        return {
          loadSettingsV3: async () => null,
          saveSettingsV3: async () => null,
          subscribeSettingsChanges: () => () => {},
        };
      }
      if (id.startsWith('.')) {
        return require(path.resolve(moduleDir, id));
      }
      return require(id);
    },
    console,
    Promise,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'use-v3-settings.js' });
  return moduleRef.exports;
}

test('react ui save reconciliation: should use persisted snapshot when no later edits exist', () => {
  const { reconcilePersistedSettings } = loadModule();
  const requested = createSettings({ activeProfileId: 'intensive' });
  const persisted = createSettings({ activeProfileId: 'intensive' });

  const result = reconcilePersistedSettings(persisted, requested, requested);

  assert.equal(result.preservedLocalEdits, false);
  assert.equal(result.saved.activeProfileId, 'intensive');
  assert.equal(result.working.activeProfileId, 'intensive');
});

test('react ui save reconciliation: should preserve edits made after save started', () => {
  const { reconcilePersistedSettings } = loadModule();
  const requested = createSettings();
  const persisted = createSettings();
  const latestWorking = createSettings({
    profilesBuiltin: {
      balanced: {
        enabled: true,
        replaceRatio: 0.25,
        maxReplaceCount: 3,
        targetCefr: 'B2',
        activeLevels: ['CET4', 'CET6'],
        reviewDanmakuSpeed: 'normal',
        vocabularyMode: 'core',
        examPreference: 'balanced',
      },
    },
  });

  const result = reconcilePersistedSettings(persisted, requested, latestWorking);

  assert.equal(result.preservedLocalEdits, true);
  assert.equal(result.saved.profilesBuiltin.balanced.replaceRatio, 0.2);
  assert.equal(result.working.profilesBuiltin.balanced.replaceRatio, 0.25);
  assert.equal(result.working.profilesBuiltin.balanced.maxReplaceCount, 3);
});
