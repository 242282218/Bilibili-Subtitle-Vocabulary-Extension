const test = require('node:test');
const assert = require('node:assert/strict');

const learningState = require('../learningState.js');

const vocabularyPath = require.resolve('../vocabulary.js');

function loadVocabularyModule() {
  delete require.cache[vocabularyPath];
  return require(vocabularyPath);
}

function createFetchResponse(level) {
  return {
    ok: true,
    async json() {
      return [
        {
          word: `${level.toLowerCase()}-word`,
          meaning: `${level}词义`,
          level,
        },
      ];
    },
  };
}

test('loadVocabulary: should keep level data when storage read fails', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const previousUtils = globalThis.Utils;
  const runtime = { lastError: null };

  globalThis.Utils = { logError() {} };
  globalThis.fetch = async (url) => {
    const normalized = String(url || '').toLowerCase();
    if (normalized.includes('cet4')) return createFetchResponse('CET4');
    if (normalized.includes('cet6')) return createFetchResponse('CET6');
    if (normalized.includes('kaoyan')) return createFetchResponse('KAOYAN');
    if (normalized.includes('ielts')) return createFetchResponse('IELTS');
    if (normalized.includes('toefl')) return createFetchResponse('TOEFL');
    throw new Error(`unexpected fetch url: ${url}`);
  };
  globalThis.chrome = {
    runtime: {
      ...runtime,
      getURL(path) {
        return path;
      },
    },
    storage: {
      local: {
        get(_keys, callback) {
          runtime.lastError = { message: 'mock read failed' };
          callback({});
          runtime.lastError = null;
        },
        set(_payload, callback) {
          runtime.lastError = null;
          callback();
        },
      },
    },
  };

  t.after(() => {
    delete require.cache[vocabularyPath];
    globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
    globalThis.Utils = previousUtils;
  });

  const vocabulary = loadVocabularyModule();
  const entries = await vocabulary.loadVocabulary();

  assert.equal(entries.length, 5);
  assert.equal(
    entries.some((entry) => entry.word === 'cet4-word'),
    true
  );
  assert.equal(
    entries.some((entry) => entry.word === 'toefl-word'),
    true
  );
});

test('refreshLearningStateFromStorage: should reject on storage read failure', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const runtime = { lastError: null };

  globalThis.Utils = { logError() {} };
  globalThis.chrome = {
    runtime,
    storage: {
      local: {
        get(_keys, callback) {
          runtime.lastError = { message: 'mock read failed' };
          callback({});
          runtime.lastError = null;
        },
        set(_payload, callback) {
          runtime.lastError = null;
          callback();
        },
      },
    },
  };

  t.after(() => {
    delete require.cache[vocabularyPath];
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const vocabulary = loadVocabularyModule();
  vocabulary.__setEntriesForTest([{ word: 'alpha', meaning: '阿尔法', level: 'CET4' }]);

  await assert.rejects(vocabulary.refreshLearningStateFromStorage(), /mock read failed/);
});

test('applyLearningAction: should return null and keep queue when storage write fails', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const runtime = { lastError: null };
  const now = 1700000000000;
  const stats = {
    alpha: learningState.normalizeLearningRecord({
      word: 'alpha',
      translation: '阿尔法',
      level: 'CET4',
      exposureCount: 2,
      seenCount: 2,
      reviewCount: 0,
      status: 'seen',
      nextReviewBucket: 'today',
      intervalDays: 1,
      nextReviewAt: now + 60 * 60 * 1000,
      lastSeenAt: now,
    }),
  };
  const queue = learningState.normalizeReviewQueue({
    alpha: {
      word: 'alpha',
      dueBucket: 'today',
      intervalDays: 1,
      nextReviewAt: now + 60 * 60 * 1000,
      updatedAt: now,
      lastSeenAt: now,
    },
  });

  globalThis.Utils = { logError() {} };
  globalThis.chrome = {
    runtime,
    storage: {
      local: {
        get(_keys, callback) {
          runtime.lastError = null;
          callback({
            [learningState.STORAGE_KEYS.WORD_STATS_V2]: stats,
            [learningState.STORAGE_KEYS.REVIEW_QUEUE]: queue,
            [learningState.STORAGE_KEYS.LEARNING_SUMMARY]: learningState.buildLearningSummary(
              stats,
              queue
            ),
          });
        },
        set(_payload, callback) {
          runtime.lastError = { message: 'mock write failed' };
          callback();
          runtime.lastError = null;
        },
      },
    },
  };

  t.after(() => {
    delete require.cache[vocabularyPath];
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const vocabulary = loadVocabularyModule();
  vocabulary.__setEntriesForTest([
    {
      word: 'alpha',
      meaning: '阿尔法',
      level: 'CET4',
      hitCount: 2,
      exposureCount: 2,
      seenCount: 2,
      learningStatus: 'seen',
      nextReviewBucket: 'today',
      intervalDays: 1,
      nextReviewAt: now + 60 * 60 * 1000,
      lastSeenAt: now,
    },
  ]);

  await vocabulary.refreshLearningStateFromStorage();
  const beforeQueue = vocabulary.getReviewQueue(1);
  const result = await vocabulary.applyLearningAction('alpha', 'know');
  const afterQueue = vocabulary.getReviewQueue(1);

  assert.equal(result, null);
  assert.equal(beforeQueue[0].word, 'alpha');
  assert.equal(beforeQueue[0].dueBucket, 'today');
  assert.equal(afterQueue[0].word, 'alpha');
  assert.equal(afterQueue[0].dueBucket, 'today');
});
