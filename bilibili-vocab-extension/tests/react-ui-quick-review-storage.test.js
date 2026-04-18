const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const STORAGE_SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'storage.ts');
const LEARNING_DASHBOARD_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'learning-dashboard.ts'
);

const WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v1';
const LEARNING_WORD_STATS_STORAGE_KEY = 'bili_vocab_word_stats_v2';
const REVIEW_QUEUE_STORAGE_KEY = 'bili_vocab_review_queue_v1';
const LEARNING_SUMMARY_STORAGE_KEY = 'bili_vocab_learning_summary_v1';

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMockDate(now) {
  return class MockDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return now;
    }
  };
}

function pickPayload(state, keys) {
  if (keys == null) {
    return cloneValue(state);
  }
  return keys.reduce((accumulator, key) => {
    accumulator[key] = cloneValue(state[key]);
    return accumulator;
  }, {});
}

function createLearningStateStub(now) {
  function normalizeWord(word) {
    return String(word || '')
      .trim()
      .toLowerCase();
  }

  function toPositiveInt(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return fallback;
    }
    return Math.floor(numeric);
  }

  function normalizeRecord(record, fallback = {}) {
    const source = record && typeof record === 'object' ? record : {};
    const word = normalizeWord(source.word || fallback.word);
    return {
      word,
      translation: String(
        source.translation || source.meaning || fallback.translation || ''
      ).trim(),
      level: String(source.level || fallback.level || '')
        .trim()
        .toUpperCase(),
      status: String(source.status || source.learningStatus || 'unseen')
        .trim()
        .toLowerCase(),
      hitCount: toPositiveInt(source.hitCount ?? source.exposureCount),
      exposureCount: toPositiveInt(source.exposureCount ?? source.hitCount),
      seenCount: toPositiveInt(source.seenCount ?? source.hitCount),
      reviewCount: toPositiveInt(source.reviewCount),
      lastSeen: toPositiveInt(source.lastSeen ?? source.lastSeenAt) || null,
      lastSeenAt: toPositiveInt(source.lastSeenAt ?? source.lastSeen) || null,
      nextReviewBucket: String(source.nextReviewBucket || 'today')
        .trim()
        .toLowerCase(),
      nextReviewAt: toPositiveInt(source.nextReviewAt) || null,
      intervalDays: Math.max(1, toPositiveInt(source.intervalDays, 1)),
      easeFactor: Number.isFinite(Number(source.easeFactor)) ? Number(source.easeFactor) : 2.3,
    };
  }

  function normalizeReviewQueue(queue) {
    if (!queue || typeof queue !== 'object') {
      return {};
    }
    const normalized = {};
    Object.keys(queue).forEach((key) => {
      const item = queue[key];
      const word = normalizeWord(item && item.word ? item.word : key);
      if (!word) {
        return;
      }
      normalized[word] = {
        word,
        dueBucket: String((item && item.dueBucket) || 'today')
          .trim()
          .toLowerCase(),
        nextReviewAt: toPositiveInt(item && item.nextReviewAt) || null,
        intervalDays: Math.max(1, toPositiveInt(item && item.intervalDays, 1)),
        easeFactor:
          item && Number.isFinite(Number(item.easeFactor)) ? Number(item.easeFactor) : 2.3,
        updatedAt: toPositiveInt(item && item.updatedAt) || now,
      };
    });
    return normalized;
  }

  function buildLearningSummary(records, queue) {
    const normalizedRecords = Object.values(records || {}).map((item) => normalizeRecord(item));
    const normalizedQueue = Object.values(normalizeReviewQueue(queue));
    return {
      todayCount: normalizedQueue.filter((item) => item.dueBucket === 'today').length,
      newCount: normalizedRecords.filter((item) => item.status === 'unseen').length,
      masteredCount: normalizedRecords.filter((item) => item.status === 'mastered').length,
      recentWords: normalizedRecords
        .slice()
        .sort((left, right) => (right.lastSeenAt || 0) - (left.lastSeenAt || 0))
        .slice(0, 5)
        .map((item) => ({
          word: item.word,
          translation: item.translation,
          status: item.status,
        })),
    };
  }

  function migrateLegacyStat(record) {
    return normalizeRecord(
      {
        ...(record || {}),
        status: 'seen',
        nextReviewBucket: 'today',
        nextReviewAt: now + 60 * 60 * 1000,
      },
      {}
    );
  }

  function applyLearningAction(record, action, actionNow) {
    const normalized = normalizeRecord(record);
    const nextBucket = action === 'know' ? 'soon' : 'today';
    const nextReviewAt =
      action === 'know' ? actionNow + 3 * 24 * 60 * 60 * 1000 : actionNow + 60 * 60 * 1000;
    return {
      ...normalized,
      status: action === 'know' ? 'saved' : action === 'fuzzy' ? 'seen' : 'unseen',
      reviewCount: normalized.reviewCount + 1,
      lastReviewedAt: actionNow,
      nextReviewBucket: nextBucket,
      nextReviewAt,
      intervalDays: action === 'know' ? 3 : 1,
      easeFactor: action === 'know' ? 2.4 : 2.1,
    };
  }

  function syncReviewQueue(queue, record, updatedAt) {
    const nextQueue = normalizeReviewQueue(queue);
    const normalized = normalizeRecord(record);
    if (!normalized.word) {
      return nextQueue;
    }
    nextQueue[normalized.word] = {
      word: normalized.word,
      dueBucket: normalized.nextReviewBucket,
      nextReviewAt: normalized.nextReviewAt,
      intervalDays: normalized.intervalDays,
      easeFactor: normalized.easeFactor,
      updatedAt,
    };
    return nextQueue;
  }

  return {
    normalizeLearningRecord: normalizeRecord,
    normalizeReviewQueue,
    buildLearningSummary,
    migrateLegacyStat,
    applyLearningAction,
    syncReviewQueue,
  };
}

function loadLearningDashboardModule(now) {
  const source = fs.readFileSync(LEARNING_DASHBOARD_SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleRef = { exports: {} };
  const MockDate = createMockDate(now);
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require,
    Date: MockDate,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(transpiled, sandbox, { filename: 'learning-dashboard.js' });
  return moduleRef.exports;
}

function createStorageModule(options = {}) {
  const now = options.now || 1700000000000;
  const source = fs.readFileSync(STORAGE_SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const storageState = cloneValue(options.initialState || {});
  const runtime = {
    lastError: null,
    openOptionsPage() {
      return Promise.resolve();
    },
    sendMessage(message, callback) {
      if (typeof options.sendMessageImpl === 'function') {
        options.sendMessageImpl({ message, callback, state: storageState, runtime });
        return;
      }
      callback({ ok: false, error: 'runtime bridge not configured' });
    },
  };
  const moduleRef = { exports: {} };
  const MockDate = createMockDate(now);
  const chrome = {
    storage: {
      local: {
        get(keys, callback) {
          callback(pickPayload(storageState, keys));
        },
        set(payload, callback) {
          Object.assign(storageState, cloneValue(payload));
          if (typeof callback === 'function') {
            callback();
          }
        },
      },
      onChanged: {
        addListener() {},
        removeListener() {},
      },
    },
    tabs: {
      query(_query, callback) {
        callback([]);
      },
    },
    runtime,
  };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require(id) {
      if (id === './settings-bridge') {
        return {
          SETTINGS_STORAGE_KEY_V3: 'bili_vocab_settings_v3',
          migrateToV3(payload) {
            return payload;
          },
          normalizeSettingsV3(settings) {
            return settings;
          },
        };
      }
      if (id === './learning-dashboard') {
        return loadLearningDashboardModule(now);
      }
      if (id === './runtime-messaging') {
        return {
          MESSAGE_TYPES: {
            SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
            ADAPTIVE_PERSIST_FEEDBACK: 'BILI_VOCAB_ADAPTIVE_PERSIST_FEEDBACK',
            ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
          },
          sendRuntimeMessage(type, payload) {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type, payload }, (response) => {
                if (runtime.lastError) {
                  reject(new Error(runtime.lastError.message));
                  return;
                }
                if (!response || response.ok !== true) {
                  reject(new Error((response && response.error) || 'runtime bridge failed'));
                  return;
                }
                resolve(response.payload);
              });
            });
          },
        };
      }
      return require(id);
    },
    chrome,
    LearningState: createLearningStateStub(now),
    Date: MockDate,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(transpiled, sandbox, { filename: 'storage.js' });
  return {
    module: moduleRef.exports,
    storageState,
  };
}

test('react ui quick review storage: should migrate legacy word stats into dashboard when v2 state is missing', async () => {
  const now = 1700000000000;
  const { module: storageModule } = createStorageModule({
    now,
    initialState: {
      [WORD_STATS_STORAGE_KEY]: {
        system: {
          word: 'system',
          translation: '系统',
          level: 'CET4',
          hitCount: 3,
          lastSeen: now - 5000,
        },
      },
      [REVIEW_QUEUE_STORAGE_KEY]: {
        system: {
          word: 'system',
          dueBucket: 'today',
          nextReviewAt: now + 60 * 60 * 1000,
          updatedAt: now - 1000,
        },
      },
    },
  });

  const dashboard = await storageModule.readQuickReviewDashboard();
  assert.equal(dashboard.summary.todayCount, 1);
  assert.equal(dashboard.items[0].word, 'system');
  assert.equal(dashboard.items[0].translation, '系统');
});

test('react ui quick review storage: submitQuickReviewFeedback should persist next state and adaptive feedback', async () => {
  const now = 1700000000000;
  const sentMessages = [];
  const { module: storageModule, storageState } = createStorageModule({
    now,
    initialState: {
      [LEARNING_WORD_STATS_STORAGE_KEY]: {
        system: {
          word: 'system',
          translation: '系统',
          level: 'CET4',
          status: 'seen',
          hitCount: 3,
          exposures: 3,
          lastSeenAt: now - 2000,
          nextReviewBucket: 'today',
          nextReviewAt: now + 60 * 1000,
          intervalDays: 1,
          easeFactor: 2.3,
          context: 'System appears in the subtitle sentence.',
          source: {
            title: 'Quick Review Episode',
            url: 'https://www.bilibili.com/video/BVquick',
            timeSeconds: 95,
            timeLabel: '01:35',
          },
          details: {
            meaning: '系统',
            level: 'CET4',
            phonetic: '/s/',
          },
        },
      },
      [REVIEW_QUEUE_STORAGE_KEY]: {
        system: {
          word: 'system',
          dueBucket: 'today',
          nextReviewAt: now + 60 * 1000,
          intervalDays: 1,
          easeFactor: 2.3,
          updatedAt: now - 1000,
        },
      },
    },
    sendMessageImpl({ message, callback }) {
      sentMessages.push(cloneValue(message));
      callback({
        ok: true,
        payload: {
          applied: true,
        },
      });
    },
  });

  const result = await storageModule.submitQuickReviewFeedback('system', 'know');
  assert.equal(result.word, 'system');
  assert.equal(result.adaptiveApplied, true);
  assert.equal(storageState[LEARNING_WORD_STATS_STORAGE_KEY].system.reviewCount, 1);
  assert.equal(storageState[REVIEW_QUEUE_STORAGE_KEY].system.dueBucket, 'soon');
  assert.equal(storageState[LEARNING_SUMMARY_STORAGE_KEY].todayCount, 0);
  assert.equal(
    storageState[LEARNING_WORD_STATS_STORAGE_KEY].system.context,
    'System appears in the subtitle sentence.'
  );
  assert.deepEqual(storageState[LEARNING_WORD_STATS_STORAGE_KEY].system.source, {
    title: 'Quick Review Episode',
    url: 'https://www.bilibili.com/video/BVquick',
    timeSeconds: 95,
    timeLabel: '01:35',
  });
  assert.deepEqual(storageState[LEARNING_WORD_STATS_STORAGE_KEY].system.details, {
    meaning: '系统',
    level: 'CET4',
    phonetic: '/s/',
  });
  assert.deepEqual(
    sentMessages.map((item) => item.type),
    ['BILI_VOCAB_ADAPTIVE_PERSIST_FEEDBACK']
  );
  assert.equal(sentMessages[0].payload.feedback, 'know');
});

test('react ui quick review storage: readEncounteredWordRanking should fallback to learning stats when legacy stats are absent', async () => {
  const now = 1700000000000;
  const { module: storageModule } = createStorageModule({
    now,
    initialState: {
      [LEARNING_WORD_STATS_STORAGE_KEY]: {
        system: {
          word: 'system',
          translation: '系统',
          level: 'CET6',
          hitCount: 5,
          lastSeenAt: now - 1000,
        },
        context: {
          word: 'context',
          translation: '语境',
          level: 'CET4',
          hitCount: 2,
          lastSeenAt: now - 500,
        },
      },
    },
  });

  const ranking = await storageModule.readEncounteredWordRanking('desc');
  assert.equal(ranking.map((item) => item.word).join(','), 'system,context');
});
