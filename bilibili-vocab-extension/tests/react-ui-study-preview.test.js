const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const ReactDOMServer = require('react-dom/server');

const SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'study-preview.tsx');

function loadStudyPreviewModule(options = {}) {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleRef = { exports: {} };
  const settingsBridge =
    options.settingsBridge || createSettingsBridgeStub(options.learningProfile || null);
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    console,
    require(id) {
      if (id === './settings-bridge') {
        return settingsBridge;
      }
      return require(id);
    },
  };

  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'study-preview.js' });
  return moduleRef.exports;
}

function createSettingsBridgeStub(learningProfile) {
  return {
    buildSettingsPreview(profile) {
      return `SUMMARY:${profile.targetCefr}:${profile.replaceRatio}`;
    },
    getBilingualModeLabel(mode) {
      return {
        default: '默认括号释义',
        bilingual: '双语对照',
        'english-only': '纯英文',
      }[mode];
    },
    getLearningProfile() {
      return (
        learningProfile || {
          tone: 'steady',
          label: '稳态输入',
          summary: '稳态摘要',
        }
      );
    },
    getMockPreviewData(_targetCefr, _replaceRatio, maxReplaceCount) {
      return ['alpha', 'beta', 'gamma'].slice(0, Math.max(2, Math.min(3, maxReplaceCount)));
    },
    getReviewDanmakuSpeedLabel(speed) {
      return `SPEED:${speed}`;
    },
    getReviewDanmakuDensityLabel(density) {
      return `DENSITY:${density}`;
    },
  };
}

function createProfile(overrides = {}) {
  return {
    enabled: true,
    replaceRatio: 0.25,
    maxReplaceCount: 3,
    targetCefr: 'B2',
    activeLevels: ['CET4', 'IELTS'],
    reviewDanmakuSpeed: 'fast',
    reviewDanmakuDensity: 'dense',
    vocabularyMode: 'core',
    examPreference: 'balanced',
    bilingualMode: 'default',
    themeMode: 'auto',
    ...overrides,
  };
}

function renderStudyPreview(options = {}) {
  const moduleExports = loadStudyPreviewModule({
    settingsBridge: options.settingsBridge,
    learningProfile: options.learningProfile,
  });
  const element = React.createElement(moduleExports.StudyPreview, {
    profile: createProfile(options.profile),
    title: options.title || '学习预览',
    subtitle: options.subtitle || '当前设置预估效果',
    sentenceVariant: options.sentenceVariant || 'popup',
    compact: options.compact === true,
  });

  return ReactDOMServer.renderToStaticMarkup(element);
}

test('react ui study preview: should render different sentence copy for popup and options variants', () => {
  const popupHtml = renderStudyPreview({ sentenceVariant: 'popup' });
  const optionsHtml = renderStudyPreview({ sentenceVariant: 'options' });

  assert.match(popupHtml, /我今天想/);
  assert.doesNotMatch(popupHtml, /这段视频会帮你/);
  assert.match(optionsHtml, /这段视频会帮你/);
  assert.doesNotMatch(optionsHtml, /我今天想/);
});

test('react ui study preview: should render default mode source text and bilingual original sentence correctly', () => {
  const defaultHtml = renderStudyPreview({
    sentenceVariant: 'popup',
    profile: { bilingualMode: 'default' },
  });
  const bilingualHtml = renderStudyPreview({
    sentenceVariant: 'popup',
    profile: { bilingualMode: 'bilingual' },
  });
  const englishOnlyHtml = renderStudyPreview({
    sentenceVariant: 'popup',
    profile: { bilingualMode: 'english-only' },
  });

  assert.match(defaultHtml, /alpha（系统）/);
  assert.doesNotMatch(defaultHtml, /原句：/);
  assert.match(bilingualHtml, /原句：我今天想系统提升英语听力和词汇反应速度。/);
  assert.doesNotMatch(bilingualHtml, /（系统）/);
  assert.doesNotMatch(englishOnlyHtml, /原句：/);
  assert.doesNotMatch(englishOnlyHtml, /（系统）/);
});

test('react ui study preview: should render metrics, compact class and learning tone tags', () => {
  const html = renderStudyPreview({
    compact: true,
    learningProfile: {
      tone: 'focus',
      label: '聚焦模式',
      summary: '聚焦摘要',
    },
  });

  assert.match(html, /study-preview--compact/);
  assert.match(html, /25%/);
  assert.match(html, /3 词/);
  assert.match(html, /SPEED:fast/);
  assert.match(html, /DENSITY:dense/);
  assert.match(html, /preview-tone--focus/);
  assert.match(html, /preview-card__tag--focus/);
  assert.match(html, /聚焦模式/);
  assert.match(html, /聚焦摘要 当前目标难度：B2 · 显示模式：默认括号释义。/);
  assert.match(html, /SUMMARY:B2:0.25/);
});
