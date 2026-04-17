const test = require('node:test');
const assert = require('node:assert/strict');

const learningStatePath = require.resolve('../learningState.js');
const LEARNING_STREAK_STORAGE_KEY = 'bili_vocab_learning_streak_v1';

function loadLearningStateModule() {
  delete require.cache[learningStatePath];
  return require(learningStatePath);
}

function createChromeStorageStub(initialState = {}) {
  const state = JSON.parse(JSON.stringify(initialState));
  const setCalls = [];
  const runtime = { lastError: null };

  return {
    state,
    setCalls,
    chrome: {
      runtime,
      storage: {
        local: {
          get(keys, callback) {
            if (Array.isArray(keys)) {
              const payload = {};
              keys.forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(state, key)) {
                  payload[key] = state[key];
                }
              });
              callback(payload);
              return;
            }
            callback({ ...state });
          },
          set(payload, callback) {
            setCalls.push(JSON.parse(JSON.stringify(payload)));
            Object.assign(state, JSON.parse(JSON.stringify(payload)));
            if (typeof callback === 'function') {
              callback();
            }
          },
        },
      },
    },
  };
}

test('learning streak: should create first active day and skip duplicate same-day writes', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const storage = createChromeStorageStub();

  globalThis.chrome = storage.chrome;
  globalThis.Utils = { logError() {} };

  t.after(() => {
    delete require.cache[learningStatePath];
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const learningState = loadLearningStateModule();
  const now = Date.parse('2026-04-18T09:00:00.000Z');

  const first = await learningState.updateLearningStreak(now);
  const second = await learningState.updateLearningStreak(now + 60 * 1000);

  assert.equal(first.currentStreak, 1);
  assert.equal(first.maxStreak, 1);
  assert.equal(first.totalActiveDays, 1);
  assert.equal(first.lastActiveDate, '2026-04-18');
  assert.deepEqual(first.activeDays, ['2026-04-18']);
  assert.equal(second.currentStreak, 1);
  assert.equal(storage.setCalls.length, 1);
  assert.deepEqual(storage.state[LEARNING_STREAK_STORAGE_KEY].activeDays, ['2026-04-18']);
});

test('learning streak: should extend an existing streak on the next active day', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const storage = createChromeStorageStub({
    [LEARNING_STREAK_STORAGE_KEY]: {
      currentStreak: 2,
      maxStreak: 2,
      lastActiveDate: '2026-04-17',
      totalActiveDays: 5,
      activeDays: ['2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'],
    },
  });

  globalThis.chrome = storage.chrome;
  globalThis.Utils = { logError() {} };

  t.after(() => {
    delete require.cache[learningStatePath];
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const learningState = loadLearningStateModule();
  const next = await learningState.updateLearningStreak(Date.parse('2026-04-18T09:00:00.000Z'));

  assert.equal(next.currentStreak, 3);
  assert.equal(next.maxStreak, 3);
  assert.equal(next.totalActiveDays, 6);
  assert.equal(next.lastActiveDate, '2026-04-18');
  assert.deepEqual(next.activeDays.slice(-2), ['2026-04-17', '2026-04-18']);
  assert.equal(storage.setCalls.length, 1);
});
