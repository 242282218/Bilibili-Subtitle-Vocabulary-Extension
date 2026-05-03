const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sharedSettings = require('../sharedSettings.js');
const options = require('../options.js');
const popup = require('../popup.js');
const overlayPanel = require('../overlayPanel.js');
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
  assert.strictEqual(popup.normalizeSettings, sharedSettings.normalizeSettings);
  assert.strictEqual(popup.getHeroMetricMeta, sharedSettings.getHeroMetricMeta);
  assert.strictEqual(popup.getLearningProfile, sharedSettings.getLearningProfile);
  assert.strictEqual(popup.normalizeReviewDanmakuSpeed, sharedSettings.normalizeReviewDanmakuSpeed);
});

test('shared settings integration: legacy settings fallbacks should stay aligned across shipped entries', () => {
  const sample = {
    enabled: false,
    webPageEnabled: false,
    reviewDanmakuEnabled: true,
    reviewDanmakuSpeed: 'fast',
    reviewDanmakuDensity: 'dense',
    vocabularyMode: 'full',
    examPreference: 'exam-first',
    activeLevels: ['cet4', 'unknown'],
    replaceRatio: 0,
    maxReplaceCount: 0,
    targetCefr: 'z9',
    bilingualMode: 'english-only',
    themeMode: 'dark',
    domainRules: {
      'Example.COM': { enabled: false },
    },
    overlayPanelHidden: true,
    overlayPanelCollapsed: true,
    overlayPanelWidth: 999,
    overlayPanelHeight: 12,
    overlayPanelOffsetRight: 1,
    overlayPanelOffsetBottom: 1,
  };

  const sharedNormalized = sharedSettings.normalizeSettings(sample);

  assert.deepEqual(options.normalizeSettings(sample), sharedNormalized);
  assert.deepEqual(popup.normalizeSettings(sample), sharedNormalized);

  const overlayNormalized = overlayPanel.normalizeOverlaySettings(sample);
  assert.equal(overlayNormalized.enabled, sharedNormalized.enabled);
  assert.equal(overlayNormalized.webPageEnabled, sharedNormalized.webPageEnabled);
  assert.equal(overlayNormalized.reviewDanmakuEnabled, sharedNormalized.reviewDanmakuEnabled);
  assert.equal(overlayNormalized.reviewDanmakuSpeed, sharedNormalized.reviewDanmakuSpeed);
  assert.equal(overlayNormalized.reviewDanmakuDensity, sharedNormalized.reviewDanmakuDensity);
  assert.equal(overlayNormalized.vocabularyMode, sharedNormalized.vocabularyMode);
  assert.equal(overlayNormalized.examPreference, sharedNormalized.examPreference);
  assert.deepEqual(overlayNormalized.activeLevels, sharedNormalized.activeLevels);
  assert.equal(overlayNormalized.replaceRatio, sharedNormalized.replaceRatio);
  assert.equal(overlayNormalized.maxReplaceCount, sharedNormalized.maxReplaceCount);
  assert.equal(overlayNormalized.targetCefr, sharedNormalized.targetCefr);
  assert.equal(overlayNormalized.bilingualMode, sharedNormalized.bilingualMode);
  assert.equal(overlayNormalized.themeMode, sharedNormalized.themeMode);
  assert.deepEqual(overlayNormalized.domainRules, sharedNormalized.domainRules);
  assert.equal(overlayNormalized.overlayPanelHidden, true);
  assert.equal(overlayNormalized.overlayPanelCollapsed, true);
  assert.equal(overlayNormalized.overlayPanelWidth, 560);
  assert.equal(overlayNormalized.overlayPanelHeight, 360);
  assert.equal(overlayNormalized.overlayPanelOffsetRight, 12);
  assert.equal(overlayNormalized.overlayPanelOffsetBottom, 24);
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

test('shared settings integration: legacy options clear helper should keep learning summary in sync', async () => {
  const previousChrome = global.chrome;
  const previousConfirm = global.confirm;
  const storageState = {
    bili_vocab_word_stats_v2: {
      savedWord: {
        word: 'beta',
        status: 'saved',
        savedAt: 1800000000000,
        exposureCount: 5,
        exposures: 5,
        details: { meaning: 'B', level: 'CET6', phonetic: '/b/' },
      },
    },
    bili_vocab_review_queue_v1: {
      beta: {
        word: 'beta',
        dueBucket: 'today',
        nextReviewAt: 1800000000000,
        intervalDays: 1,
        easeFactor: 2.3,
        updatedAt: 1800000000000,
      },
    },
    bili_vocab_learning_streak_v1: {
      currentStreak: 0,
      maxStreak: 0,
      lastActiveDate: '',
      totalActiveDays: 0,
      activeDays: [],
    },
  };
  const writePayloads = [];

  global.confirm = () => true;
  global.chrome = {
    runtime: {
      lastError: null,
    },
    storage: {
      local: {
        get(keys, callback) {
          const requestedKeys = Array.isArray(keys) ? keys : Object.keys(storageState);
          const payload = {};
          requestedKeys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(storageState, key)) {
              payload[key] = storageState[key];
            }
          });
          callback(payload);
        },
        set(payload, callback) {
          writePayloads.push(JSON.parse(JSON.stringify(payload)));
          Object.assign(storageState, payload);
          callback();
        },
      },
    },
  };

  try {
    await options.clearVocabularyBook();
  } finally {
    global.chrome = previousChrome;
    global.confirm = previousConfirm;
  }

  assert.equal(writePayloads.length, 1);
  assert.equal(writePayloads[0].bili_vocab_word_stats_v2.savedWord.status, 'seen');
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      writePayloads[0].bili_vocab_word_stats_v2.savedWord,
      'savedAt'
    ),
    false
  );
  assert.equal(writePayloads[0].bili_vocab_learning_summary_v1.savedCount, 0);
  assert.equal(writePayloads[0].bili_vocab_learning_summary_v1.seenCount, 1);
});
