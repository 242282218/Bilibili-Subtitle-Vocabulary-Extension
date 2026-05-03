const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'overlay-settings.ts');

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createOverlaySettingsModule() {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
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
    console,
    Date,
    JSON,
    Math,
    Set,
    window: {},
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'overlay-settings.js' });
  return moduleRef.exports;
}

test('react overlay settings contract: should clamp shipped overlay panel size and offsets', () => {
  const overlaySettings = createOverlaySettingsModule();

  const normalized = overlaySettings.normalizeSettingsV3({
    globalControls: {
      overlayState: {
        hidden: true,
        collapsed: false,
        width: 999,
        height: 120,
        offsetRight: 4,
        offsetBottom: 480,
      },
    },
  });

  assert.equal(normalized.globalControls.overlayState.hidden, true);
  assert.equal(normalized.globalControls.overlayState.collapsed, false);
  assert.equal(normalized.globalControls.overlayState.width, 560);
  assert.equal(normalized.globalControls.overlayState.height, 360);
  assert.equal(normalized.globalControls.overlayState.offsetRight, 12);
  assert.equal(normalized.globalControls.overlayState.offsetBottom, 240);
});

test('react overlay settings contract: should expose shipped builtin overlay profiles', () => {
  const overlaySettings = createOverlaySettingsModule();
  const normalized = overlaySettings.normalizeSettingsV3({});

  assert.deepEqual(
    cloneValue(
      ['gentle', 'balanced', 'intensive'].map((profileId) =>
        overlaySettings.getProfileConfigById(normalized, profileId)
      )
    ),
    [
      {
        enabled: true,
        replaceRatio: 0.15,
        maxReplaceCount: 1,
        targetCefr: 'B2',
        activeLevels: ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'],
        reviewDanmakuSpeed: 'slow',
        reviewDanmakuDensity: 'sparse',
        vocabularyMode: 'core',
        examPreference: 'balanced',
        bilingualMode: 'default',
        themeMode: 'auto',
      },
      {
        enabled: true,
        replaceRatio: 0.2,
        maxReplaceCount: 2,
        targetCefr: 'B2',
        activeLevels: ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'],
        reviewDanmakuSpeed: 'normal',
        reviewDanmakuDensity: 'normal',
        vocabularyMode: 'core',
        examPreference: 'balanced',
        bilingualMode: 'default',
        themeMode: 'auto',
      },
      {
        enabled: true,
        replaceRatio: 0.3,
        maxReplaceCount: 4,
        targetCefr: 'B2',
        activeLevels: ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'],
        reviewDanmakuSpeed: 'fast',
        reviewDanmakuDensity: 'dense',
        vocabularyMode: 'core',
        examPreference: 'balanced',
        bilingualMode: 'default',
        themeMode: 'auto',
      },
    ]
  );
});
