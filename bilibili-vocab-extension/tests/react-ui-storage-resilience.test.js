const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const STORAGE_SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'storage.ts');
const STORAGE_SOURCE_DIR = path.dirname(STORAGE_SOURCE_PATH);
const LEARNING_DASHBOARD_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'learning-dashboard.ts'
);
const SETTINGS_STORAGE_KEY_V3 = 'bili_vocab_settings_v3';
const ADAPTIVE_TUNING_STORAGE_KEY = 'bili_vocab_adaptive_tuning_v1';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';

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

    static parse(value) {
      return Date.parse(value);
    }

    static UTC(...args) {
      return Date.UTC(...args);
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
      runtime.lastError = { message: 'sendMessage unavailable' };
      if (typeof callback === 'function') {
        callback(undefined);
      }
      runtime.lastError = null;
    },
  };
  const moduleRef = { exports: {} };
  const MockDate = createMockDate(options.now || 1700000000000);
  const chrome = {
    storage: {
      local: {
        get(keys, callback) {
          if (typeof options.getImpl === 'function') {
            options.getImpl({ keys, callback, state: storageState, runtime });
            return;
          }
          callback(pickPayload(storageState, keys));
        },
        set(payload, callback) {
          if (typeof options.setImpl === 'function') {
            options.setImpl({ payload, callback, state: storageState, runtime });
            return;
          }
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
          SETTINGS_STORAGE_KEY_V3,
          migrateToV3(payload) {
            return payload;
          },
          normalizeSettingsV3(settings) {
            return settings;
          },
        };
      }
      if (id === './learning-dashboard') {
        return loadLearningDashboardModule(options.now || 1700000000000);
      }
      if (id === './runtime-messaging') {
        return {
          MESSAGE_TYPES: {
            SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
            ADAPTIVE_PERSIST_FEEDBACK: 'BILI_VOCAB_ADAPTIVE_PERSIST_FEEDBACK',
            ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
          },
          hasRuntimeMessaging() {
            return true;
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
      if (id.startsWith('.')) {
        return require(path.resolve(STORAGE_SOURCE_DIR, id));
      }
      return require(id);
    },
    chrome,
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
    runtime,
  };
}

test('react ui storage resilience: readStorage should reject on chrome runtime read error', async () => {
  const { module: storageModule } = createStorageModule({
    getImpl({ callback, runtime }) {
      runtime.lastError = { message: 'storage unavailable' };
      callback(undefined);
      runtime.lastError = null;
    },
  });

  await assert.rejects(storageModule.readStorage(null), /storage unavailable/);
});

test('react ui storage resilience: loadSettingsV3 should not overwrite storage after read failure', async () => {
  let setCalls = 0;
  const { module: storageModule } = createStorageModule({
    getImpl({ callback, runtime }) {
      runtime.lastError = { message: 'storage unavailable' };
      callback(undefined);
      runtime.lastError = null;
    },
    setImpl({ callback }) {
      setCalls += 1;
      if (typeof callback === 'function') {
        callback();
      }
    },
  });

  await assert.rejects(storageModule.loadSettingsV3(), /storage unavailable/);
  assert.equal(setCalls, 0);
});

test('react ui storage resilience: loadSettingsV3 should not overwrite newer v3 settings discovered after migration read', async () => {
  let getCalls = 0;
  let setCalls = 0;
  const newerSettings = {
    schemaVersion: 3,
    activeProfileId: 'intensive',
  };
  const { module: storageModule } = createStorageModule({
    getImpl({ keys, callback }) {
      getCalls += 1;
      if (getCalls === 1) {
        callback({
          enabled: true,
          replaceRatio: 0.2,
        });
        return;
      }

      assert.equal(Array.isArray(keys), true);
      assert.equal(keys.length, 1);
      assert.equal(keys[0], SETTINGS_STORAGE_KEY_V3);
      callback({
        [SETTINGS_STORAGE_KEY_V3]: newerSettings,
      });
    },
    setImpl({ callback }) {
      setCalls += 1;
      if (typeof callback === 'function') {
        callback();
      }
    },
  });

  const loaded = await storageModule.loadSettingsV3();
  assert.equal(getCalls, 2);
  assert.equal(setCalls, 0);
  assert.deepEqual(loaded, newerSettings);
});

test('react ui storage resilience: saveSettingsV3 should delegate without rewriting metrics payload', async () => {
  const { module: storageModule, storageState } = createStorageModule({
    initialState: {
      [EXPERIENCE_METRICS_STORAGE_KEY]: {
        schemaVersion: 1,
        updatedAt: 1700000000000,
        counters: {
          adaptiveManualOverride: 3,
        },
        daily: {
          '2023-11-14': {
            adaptiveManualOverride: 3,
          },
        },
        events: [{ type: 'context-misreplace', at: 1700000000000 }],
      },
    },
    sendMessageImpl({ message, callback, state, runtime }) {
      setTimeout(() => {
        runtime.lastError = null;
        if (message.type !== 'BILI_VOCAB_SETTINGS_COMMIT') {
          callback({ ok: false, error: 'unexpected message' });
          return;
        }
        state[SETTINGS_STORAGE_KEY_V3] = cloneValue(message.payload.settings);
        callback({
          ok: true,
          payload: cloneValue(message.payload.settings),
        });
      }, 5);
    },
  });

  await Promise.all([
    storageModule.saveSettingsV3({ schemaVersion: 3, activeProfileId: 'gentle' }),
    storageModule.saveSettingsV3({ schemaVersion: 3, activeProfileId: 'balanced' }),
  ]);

  assert.equal(storageState[SETTINGS_STORAGE_KEY_V3].activeProfileId, 'balanced');
  assert.equal(storageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride, 3);
  assert.deepEqual(storageState[EXPERIENCE_METRICS_STORAGE_KEY].events, [
    { type: 'context-misreplace', at: 1700000000000 },
  ]);
});

test('react ui storage resilience: setAdaptiveTuningEnabled should delegate to runtime bridge', async () => {
  const now = 1700000000000;
  const { module: storageModule } = createStorageModule({
    initialState: {
      [ADAPTIVE_TUNING_STORAGE_KEY]: {
        enabled: false,
      },
    },
    sendMessageImpl({ message, callback, runtime }) {
      setTimeout(() => {
        runtime.lastError = null;
        if (message.type !== 'BILI_VOCAB_ADAPTIVE_SET_ENABLED') {
          callback({ ok: false, error: 'unexpected message' });
          return;
        }
        callback({
          ok: true,
          payload: {
            enabled: true,
            manualOverrideUntil: now + 60 * 1000,
          },
        });
      }, 5);
    },
  });

  const nextState = await storageModule.setAdaptiveTuningEnabled(true);
  assert.equal(nextState.enabled, true);
  assert.equal(nextState.manualOverrideActive, true);
});

test('react ui storage resilience: clearVocabularyBook should only downgrade saved words', async () => {
  const { module: storageModule, storageState } = createStorageModule({
    initialState: {
      bili_vocab_word_stats_v2: {
        savedWord: {
          word: 'alpha',
          status: 'saved',
          savedAt: 1700000000000,
          exposures: 3,
          details: { meaning: 'A' },
        },
        seenWord: {
          word: 'beta',
          status: 'seen',
          exposures: 1,
        },
        malformedSaved: {
          status: 'saved',
          note: 'missing-word',
        },
        malformed: 'bad-record',
      },
    },
  });

  const clearedCount = await storageModule.clearVocabularyBook();

  assert.equal(clearedCount, 2);
  assert.equal(storageState.bili_vocab_word_stats_v2.savedWord.status, 'seen');
  assert.equal('savedAt' in storageState.bili_vocab_word_stats_v2.savedWord, false);
  assert.equal(storageState.bili_vocab_word_stats_v2.savedWord.exposures, 3);
  assert.equal(storageState.bili_vocab_word_stats_v2.seenWord.status, 'seen');
  assert.equal(storageState.bili_vocab_word_stats_v2.malformedSaved.status, 'seen');
  assert.equal(storageState.bili_vocab_word_stats_v2.malformed, 'bad-record');
});

test('react ui storage resilience: clearVocabularyBook should keep storage unchanged when write fails', async () => {
  const initialState = {
    bili_vocab_word_stats_v2: {
      savedWord: {
        word: 'alpha',
        status: 'saved',
        savedAt: 1700000000000,
      },
    },
  };
  const { module: storageModule, storageState } = createStorageModule({
    initialState,
    setImpl({ callback, runtime }) {
      runtime.lastError = { message: 'storage write failed' };
      if (typeof callback === 'function') {
        callback();
      }
      runtime.lastError = null;
    },
  });

  await assert.rejects(storageModule.clearVocabularyBook(), /storage write failed/);
  assert.deepEqual(storageState, initialState);
});
