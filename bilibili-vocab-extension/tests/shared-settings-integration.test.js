const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sharedSettings = require('../sharedSettings.js');
const options = require('../options.js');
const popup = require('../popup.js');
const background = require('../background.js');

const LEARNING_DASHBOARD_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'learning-dashboard.ts'
);

function loadLearningDashboardModule() {
  const source = fs.readFileSync(LEARNING_DASHBOARD_SOURCE_PATH, 'utf8');
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
    Date,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(transpiled, sandbox, { filename: 'learning-dashboard.js' });
  return moduleRef.exports;
}

test('shared settings integration: options should reuse shared defaults and helpers', () => {
  assert.deepEqual(options.getInitialOptionsSettings(), sharedSettings.DEFAULT_SETTINGS);
  assert.equal(options.getInitialOptionsSettings().webPageEnabled, true);
  assert.strictEqual(options.normalizeSettings, sharedSettings.normalizeSettings);
  assert.strictEqual(options.getHeroMetricMeta, sharedSettings.getHeroMetricMeta);
  assert.strictEqual(options.getLearningProfile, sharedSettings.getLearningProfile);
});

test('shared settings integration: popup should reuse shared defaults and helpers', () => {
  assert.deepEqual(popup.getInitialPopupSettings(), sharedSettings.DEFAULT_SETTINGS);
  assert.equal(popup.getInitialPopupSettings().webPageEnabled, true);
  assert.strictEqual(popup.getHeroMetricMeta, sharedSettings.getHeroMetricMeta);
  assert.strictEqual(popup.getLearningProfile, sharedSettings.getLearningProfile);
  assert.strictEqual(popup.normalizeReviewDanmakuSpeed, sharedSettings.normalizeReviewDanmakuSpeed);
});

test('shared settings integration: background should reuse shared speed normalization', () => {
  assert.strictEqual(
    background.normalizeReviewDanmakuSpeed,
    sharedSettings.normalizeReviewDanmakuSpeed
  );
});

test('shared settings integration: popup ranking helper should stay aligned with shipped learning dashboard normalization', () => {
  const dashboard = loadLearningDashboardModule();
  const rawRecord = {
    word: '  optimize ',
    meaning: '优化',
    exposureCount: '3',
    lastSeenAt: '1700000000000',
  };

  assert.deepEqual(
    JSON.parse(JSON.stringify(popup.normalizeWordStat(rawRecord))),
    JSON.parse(JSON.stringify(dashboard.normalizeEncounteredWord(rawRecord)))
  );
});

test('shared settings integration: legacy options export payload should keep shipped context and source columns', () => {
  const exportPayload = options.buildVocabularyExportPayload(
    [
      {
        status: 'saved',
        word: 'beta',
        savedAt: 1800000000000,
        exposures: 5,
        context: 'Beta appears in the next subtitle sentence.',
        source: {
          title: 'Beta Episode',
          url: 'https://www.bilibili.com/video/BVbeta',
          timeSeconds: 3723,
          timeLabel: '1:02:03',
        },
        details: { meaning: 'B', level: 'CET6', phonetic: '/b/' },
      },
    ],
    'anki'
  );

  const [header, firstRow] = exportPayload.content.split('\n');
  assert.equal(
    header,
    'Front\tBack\tExample\tLevel\tPhonetic\tSavedAt\tSourceTitle\tSourceUrl\tSourceTime'
  );
  assert.match(
    firstRow,
    /^beta\tB\tBeta appears in the next subtitle sentence\.\tCET6\t\/b\/\t.+\tBeta Episode\thttps:\/\/www\.bilibili\.com\/video\/BVbeta\t1:02:03$/
  );

  const csvPayload = options.buildVocabularyExportPayload(
    [
      {
        status: 'saved',
        word: 'beta',
        savedAt: 1800000000000,
        exposures: 5,
        context: 'Beta appears in the next subtitle sentence.',
        source: {
          title: 'Beta Episode',
          url: 'https://www.bilibili.com/video/BVbeta',
          timeSeconds: 3723,
          timeLabel: '1:02:03',
        },
        details: { meaning: 'B', level: 'CET6', phonetic: '/b/' },
      },
    ],
    'csv'
  );

  assert.match(
    csvPayload.content.split('\n')[0],
    /^单词,释义,难度等级,音标,原句上下文,来源标题,来源链接,来源时间点,收藏时间,遇见次数$/
  );
  assert.match(csvPayload.content, /"Beta appears in the next subtitle sentence\."/);
  assert.match(csvPayload.content, /"Beta Episode"/);
  assert.match(csvPayload.content, /"https:\/\/www\.bilibili\.com\/video\/BVbeta"/);
  assert.match(csvPayload.content, /"1:02:03"/);

  const jsonPayload = options.buildVocabularyExportPayload(
    [
      {
        status: 'saved',
        word: 'beta',
        savedAt: 1800000000000,
        exposures: 5,
        context: 'Beta appears in the next subtitle sentence.',
        source: {
          title: 'Beta Episode',
          url: 'https://www.bilibili.com/video/BVbeta',
          timeSeconds: 3723,
          timeLabel: '1:02:03',
        },
        details: { meaning: 'B', level: 'CET6', phonetic: '/b/' },
      },
    ],
    'json'
  );

  assert.deepEqual(JSON.parse(jsonPayload.content), [
    {
      word: 'beta',
      status: 'saved',
      translation: '',
      level: '',
      savedAt: 1800000000000,
      exposures: 5,
      context: 'Beta appears in the next subtitle sentence.',
      source: {
        title: 'Beta Episode',
        url: 'https://www.bilibili.com/video/BVbeta',
        timeSeconds: 3723,
        timeLabel: '1:02:03',
      },
      details: {
        meaning: 'B',
        level: 'CET6',
        phonetic: '/b/',
      },
    },
  ]);
});
