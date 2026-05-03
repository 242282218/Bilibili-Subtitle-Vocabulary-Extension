const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const PROJECT_ROOT = path.join(__dirname, '..');
const SETTINGS_BRIDGE_SOURCE_PATH = path.join(
  PROJECT_ROOT,
  'react-ui',
  'src',
  'settings-bridge.ts'
);

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(PROJECT_ROOT, fileName), 'utf8');
}

function loadSettingsBridgeModule(sharedSettings = {}) {
  const source = fs.readFileSync(SETTINGS_BRIDGE_SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleRef = { exports: {} };
  const windowRef = { SharedSettings: sharedSettings };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require(id) {
      return require(id);
    },
    window: windowRef,
    console,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'settings-bridge.js' });
  return moduleRef.exports;
}

test('react ui preview contract: settings bridge should expose shared preset and preview helpers', () => {
  const bridge = loadSettingsBridgeModule();

  assert.equal(bridge.SCENE_PRESETS.light.replaceRatio, 0.15);
  assert.equal(bridge.SCENE_PRESETS.light.maxReplaceCount, 1);
  assert.equal(bridge.SCENE_PRESETS.light.reviewDanmakuSpeed, 'slow');
  assert.equal(bridge.SCENE_PRESETS.light.reviewDanmakuDensity, 'sparse');
  assert.equal(
    bridge.getPresetKeyFromSettings({
      enabled: true,
      replaceRatio: 0.3,
      maxReplaceCount: 4,
      reviewDanmakuSpeed: 'fast',
      reviewDanmakuDensity: 'dense',
    }),
    'intensive'
  );
  assert.equal(
    JSON.stringify(bridge.getMockPreviewData('C1', 0.3, 4)),
    JSON.stringify(['internalize', 'retention', 'comprehension'])
  );
  assert.equal(bridge.getLearningProfile({ enabled: false }).label, '轻量待机');
  assert.match(
    bridge.buildSettingsPreview({
      enabled: true,
      replaceRatio: 0.2,
      maxReplaceCount: 2,
      targetCefr: 'B2',
      activeLevels: ['CET4', 'IELTS'],
      reviewDanmakuSpeed: 'normal',
      reviewDanmakuDensity: 'normal',
      vocabularyMode: 'core',
      examPreference: 'balanced',
      bilingualMode: 'bilingual',
    }),
    /双语对照/
  );
});

test('react ui preview contract: options should render scene presets and shipped strategy preview', () => {
  const source = readProjectFile('react-ui/src/options-main.tsx');

  assert.match(source, /SCENE_PRESETS/);
  assert.match(source, /策略预设/);
  assert.match(source, /scene-preset-card/);
  assert.match(source, /实时策略预览/);
  assert.match(source, /<StudyPreview/);
  assert.match(source, /双语显示模式/);
  assert.match(source, /bilingualMode/);
  assert.match(source, /主题模式/);
  assert.match(source, /themeMode/);
});

test('react ui preview contract: popup should render shipped study preview instead of only legacy mockups', () => {
  const source = readProjectFile('react-ui/src/popup-main.tsx');

  assert.match(source, /StudyPreview/);
  assert.match(source, /实时学习预览/);
  assert.match(source, /sentenceVariant="popup"/);
  assert.match(source, /显示模式/);
  assert.match(source, /popupBilingualMode/);
  assert.match(source, /popupThemeMode/);
});
