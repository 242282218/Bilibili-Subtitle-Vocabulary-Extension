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
const LEARNING_STATE_SOURCE_PATH = path.join(__dirname, '..', 'learningState.js');
const SETTINGS_STORAGE_KEY_V3 = 'bili_vocab_settings_v3';
const ADAPTIVE_TUNING_STORAGE_KEY = 'bili_vocab_adaptive_tuning_v1';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';
const LEARNING_STREAK_STORAGE_KEY = 'bili_vocab_learning_streak_v1';
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

    static parse(value) {
      return Date.parse(value);
    }

    static UTC(...args) {
      return Date.UTC(...args);
    }
  };
}

function createManualTimerApi() {
  let nextId = 1;
  const pendingTimers = new Map();
  return {
    setTimeout(callback, _delay, ...args) {
      const id = nextId;
      nextId += 1;
      pendingTimers.set(id, { callback, args });
      return id;
    },
    clearTimeout(id) {
      pendingTimers.delete(id);
    },
    runNextTimer() {
      const next = pendingTimers.entries().next();
      if (next.done) {
        return false;
      }
      const [id, timer] = next.value;
      pendingTimers.delete(id);
      timer.callback(...timer.args);
      return true;
    },
    getPendingCount() {
      return pendingTimers.size;
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
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
  const storageChangeListeners = new Set();
  const tabActivatedListeners = new Set();
  const tabUpdatedListeners = new Set();
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
        addListener(listener) {
          storageChangeListeners.add(listener);
        },
        removeListener(listener) {
          storageChangeListeners.delete(listener);
        },
      },
    },
    tabs: {
      query(query, callback) {
        if (typeof options.tabsQueryImpl === 'function') {
          options.tabsQueryImpl({ query, callback, runtime });
          return;
        }
        callback([]);
      },
      sendMessage(tabId, message, callback) {
        if (typeof options.tabsSendMessageImpl === 'function') {
          options.tabsSendMessageImpl({ tabId, message, callback, runtime });
          return;
        }
        runtime.lastError = { message: 'tabs.sendMessage unavailable' };
        if (typeof callback === 'function') {
          callback(undefined);
        }
        runtime.lastError = null;
      },
      connect(tabId, connectInfo) {
        if (typeof options.tabsConnectImpl === 'function') {
          return options.tabsConnectImpl({ tabId, connectInfo, runtime });
        }
        throw new Error('tabs.connect unavailable');
      },
      onActivated: {
        addListener(listener) {
          tabActivatedListeners.add(listener);
        },
        removeListener(listener) {
          tabActivatedListeners.delete(listener);
        },
      },
      onUpdated: {
        addListener(listener) {
          tabUpdatedListeners.add(listener);
        },
        removeListener(listener) {
          tabUpdatedListeners.delete(listener);
        },
      },
    },
    permissions: {
      contains(permission, callback) {
        if (typeof options.permissionsContainsImpl === 'function') {
          options.permissionsContainsImpl({ permission, callback, runtime });
          return;
        }
        callback(false);
      },
      request(permission, callback) {
        if (typeof options.permissionsRequestImpl === 'function') {
          options.permissionsRequestImpl({ permission, callback, runtime });
          return;
        }
        callback(false);
      },
      remove(permission, callback) {
        if (typeof options.permissionsRemoveImpl === 'function') {
          options.permissionsRemoveImpl({ permission, callback, runtime });
          return;
        }
        callback(false);
      },
    },
    scripting: {
      insertCSS(injection, callback) {
        if (typeof options.scriptingInsertCssImpl === 'function') {
          options.scriptingInsertCssImpl({ injection, callback, runtime });
          return;
        }
        if (typeof callback === 'function') {
          callback();
        }
      },
      executeScript(injection, callback) {
        if (typeof options.scriptingExecuteScriptImpl === 'function') {
          options.scriptingExecuteScriptImpl({ injection, callback, runtime });
          return;
        }
        if (typeof callback === 'function') {
          callback([]);
        }
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
    LearningState: require(LEARNING_STATE_SOURCE_PATH),
    Date: MockDate,
    URL,
    Promise,
    setTimeout: options.setTimeoutImpl || setTimeout,
    clearTimeout: options.clearTimeoutImpl || clearTimeout,
    console,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'storage.js' });
  return {
    module: moduleRef.exports,
    storageState,
    runtime,
    emitStorageChange(changes, areaName = 'local') {
      storageChangeListeners.forEach((listener) => {
        listener(changes, areaName);
      });
    },
    emitTabActivated(activeInfo) {
      tabActivatedListeners.forEach((listener) => {
        listener(activeInfo);
      });
    },
    emitTabUpdated(tabId, changeInfo, tab) {
      tabUpdatedListeners.forEach((listener) => {
        listener(tabId, changeInfo, tab);
      });
    },
  };
}

function flushAsyncWork() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createMockPort(name) {
  const messageListeners = new Set();
  const disconnectListeners = new Set();
  let disconnected = false;

  return {
    name,
    get disconnected() {
      return disconnected;
    },
    onMessage: {
      addListener(listener) {
        messageListeners.add(listener);
      },
      removeListener(listener) {
        messageListeners.delete(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.add(listener);
      },
      removeListener(listener) {
        disconnectListeners.delete(listener);
      },
    },
    emitMessage(message) {
      messageListeners.forEach((listener) => {
        listener(message);
      });
    },
    disconnect() {
      if (disconnected) {
        return;
      }
      disconnected = true;
      disconnectListeners.forEach((listener) => {
        listener();
      });
    },
  };
}

test('react ui storage resilience: content runtime script list should mirror manifest order', () => {
  const { module: storageModule } = createStorageModule();
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const shippedEntry = manifest.content_scripts.find((entry) => Array.isArray(entry.js));

  assert.ok(shippedEntry);
  assert.deepEqual(Array.from(storageModule.CONTENT_RUNTIME_SCRIPT_FILES), shippedEntry.js);
});

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

test('react ui storage resilience: storage mutation timeout should release the queue', async () => {
  const manualTimers = createManualTimerApi();
  const committedProfiles = [];
  const { module: storageModule } = createStorageModule({
    setTimeoutImpl: manualTimers.setTimeout,
    clearTimeoutImpl: manualTimers.clearTimeout,
    sendMessageImpl({ message, callback }) {
      committedProfiles.push(message.payload.settings.activeProfileId);
      if (message.payload.settings.activeProfileId === 'stuck') {
        return;
      }
      callback({
        ok: true,
        payload: cloneValue(message.payload.settings),
      });
    },
  });

  const stuckMutation = storageModule.saveSettingsV3({
    schemaVersion: 3,
    activeProfileId: 'stuck',
  });
  const nextMutation = storageModule.saveSettingsV3({
    schemaVersion: 3,
    activeProfileId: 'after-timeout',
  });

  await flushMicrotasks();
  assert.deepEqual(committedProfiles, ['stuck']);
  assert.equal(manualTimers.getPendingCount(), 1);

  assert.equal(manualTimers.runNextTimer(), true);
  await assert.rejects(stuckMutation, /Storage mutation timed out after \d+ms/);

  const nextSettings = await nextMutation;
  assert.equal(nextSettings.activeProfileId, 'after-timeout');
  assert.deepEqual(committedProfiles, ['stuck', 'after-timeout']);
  assert.equal(manualTimers.getPendingCount(), 0);
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

test('react ui storage resilience: readLearningStreak should normalize malformed streak payload', async () => {
  const { module: storageModule } = createStorageModule({
    initialState: {
      [LEARNING_STREAK_STORAGE_KEY]: {
        currentStreak: '4.8',
        maxStreak: 'bad',
        lastActiveDate: 20260418,
        totalActiveDays: -3,
        activeDays: ['2026-04-18', '', null],
      },
    },
  });

  const streak = cloneValue(await storageModule.readLearningStreak());

  assert.deepEqual(streak, {
    currentStreak: 4,
    maxStreak: 0,
    lastActiveDate: '20260418',
    totalActiveDays: 0,
    activeDays: ['2026-04-18'],
  });
});

test('react ui storage resilience: subscribeLearningStreak should normalize storage changes', () => {
  const { module: storageModule, emitStorageChange } = createStorageModule();
  const updates = [];

  const unsubscribe = storageModule.subscribeLearningStreak((next) => {
    updates.push(next);
  });

  emitStorageChange({
    [LEARNING_STREAK_STORAGE_KEY]: {
      newValue: {
        currentStreak: 3,
        maxStreak: 6,
        lastActiveDate: '2026-04-18',
        totalActiveDays: 9,
        activeDays: ['2026-04-16', '2026-04-17', '2026-04-18'],
      },
    },
  });

  assert.equal(updates.length, 1);
  assert.deepEqual(cloneValue(updates[0]), {
    currentStreak: 3,
    maxStreak: 6,
    lastActiveDate: '2026-04-18',
    totalActiveDays: 9,
    activeDays: ['2026-04-16', '2026-04-17', '2026-04-18'],
  });

  unsubscribe();
  emitStorageChange({
    [LEARNING_STREAK_STORAGE_KEY]: {
      newValue: {
        currentStreak: 4,
      },
    },
  });
  assert.equal(updates.length, 1);
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
          lastSeenAt: 1700000000000,
          details: { meaning: 'A' },
        },
        seenWord: {
          word: 'beta',
          status: 'seen',
          exposures: 1,
          lastSeenAt: 1699999999000,
        },
        malformedSaved: {
          status: 'saved',
          lastSeenAt: 1699999998000,
          note: 'missing-word',
        },
        malformed: 'bad-record',
      },
      [LEARNING_SUMMARY_STORAGE_KEY]: {
        todayCount: 0,
        newCount: 0,
        masteredCount: 0,
        recentWords: [
          { word: 'alpha', status: 'saved' },
          { word: 'malformedsaved', status: 'saved' },
        ],
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
  assert.deepEqual(storageState[LEARNING_SUMMARY_STORAGE_KEY].recentWords, [
    { word: 'alpha', translation: '', status: 'seen' },
    { word: 'beta', translation: '', status: 'seen' },
    { word: 'malformedsaved', translation: '', status: 'seen' },
  ]);
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

test('react ui storage resilience: readActiveTabSubtitleNavigation should normalize tab snapshot payload', async () => {
  let tabsQueryCalls = 0;
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      tabsQueryCalls += 1;
      callback([
        {
          id: 7,
          url: 'https://www.bilibili.com/video/BV1xx411c7mD',
        },
      ]);
    },
    tabsSendMessageImpl({ message, callback, runtime }) {
      runtime.lastError = null;
      assert.equal(message.type, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ');
      callback({
        ok: true,
        payload: {
          supported: true,
          progressLabel: '12 / 48',
          headline: '当前字幕',
          description: '00:15.2 - 00:18.4 · 可直接回看上一句或跳到下一句。',
          currentText: '这就是当前字幕内容',
          canGoPrevious: true,
          canReplay: true,
          canGoNext: false,
        },
      });
    },
  });

  const snapshot = cloneValue(await storageModule.readActiveTabSubtitleNavigation());

  assert.equal(tabsQueryCalls, 1);
  assert.deepEqual(snapshot, {
    supported: true,
    progressLabel: '12 / 48',
    headline: '当前字幕',
    description: '00:15.2 - 00:18.4 · 可直接回看上一句或跳到下一句。',
    currentText: '这就是当前字幕内容',
    canGoPrevious: true,
    canReplay: true,
    canGoNext: false,
  });
});

test('react ui storage resilience: readActiveTabSubtitleStatus should keep hostname and snapshot on one active tab query', async () => {
  let tabsQueryCalls = 0;
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      tabsQueryCalls += 1;
      callback([
        {
          id: 70,
          url: 'https://www.bilibili.com/video/BV1shared',
        },
      ]);
    },
    tabsSendMessageImpl({ message, callback, runtime }) {
      runtime.lastError = null;
      assert.equal(message.type, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_READ');
      callback({
        ok: true,
        payload: {
          supported: true,
          progressLabel: '5 / 18',
          headline: '当前字幕',
          description: '00:08.2 - 00:10.4 · 可直接回看上一句或跳到下一句。',
          currentText: '共享快照',
          canGoPrevious: true,
          canReplay: true,
          canGoNext: true,
        },
      });
    },
  });

  const status = cloneValue(await storageModule.readActiveTabSubtitleStatus());

  assert.equal(tabsQueryCalls, 1);
  assert.deepEqual(status, {
    hostname: 'www.bilibili.com',
    subtitleNavigation: {
      supported: true,
      progressLabel: '5 / 18',
      headline: '当前字幕',
      description: '00:08.2 - 00:10.4 · 可直接回看上一句或跳到下一句。',
      currentText: '共享快照',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: true,
    },
  });
});

test('react ui storage resilience: subscribeActiveTabSubtitleStatus should stream updates, reconnect on tab switch, and fallback on disconnect', async () => {
  let activeTab = {
    id: 70,
    url: 'https://www.bilibili.com/video/BV1shared',
  };
  const ports = [];
  const updates = [];
  const { module: storageModule, emitTabActivated } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([cloneValue(activeTab)]);
    },
    tabsConnectImpl({ tabId, connectInfo }) {
      assert.equal(connectInfo.name, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE');
      const port = createMockPort(connectInfo.name);
      ports.push({ tabId, port });
      return port;
    },
  });

  const unsubscribe = storageModule.subscribeActiveTabSubtitleStatus((status) => {
    updates.push(cloneValue(status));
  });

  await flushAsyncWork();
  assert.equal(ports.length, 1);
  assert.equal(ports[0].tabId, 70);

  ports[0].port.emitMessage({
    type: 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE',
    payload: {
      supported: true,
      progressLabel: '5 / 18',
      headline: '当前字幕',
      description: '00:08.2 - 00:10.4 · 可直接回看上一句或跳到下一句。',
      currentText: '共享快照',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: true,
    },
  });

  assert.deepEqual(updates[0], {
    hostname: 'www.bilibili.com',
    subtitleNavigation: {
      supported: true,
      progressLabel: '5 / 18',
      headline: '当前字幕',
      description: '00:08.2 - 00:10.4 · 可直接回看上一句或跳到下一句。',
      currentText: '共享快照',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: true,
    },
  });

  activeTab = {
    id: 71,
    url: 'https://www.bilibili.com/video/BV1next',
  };
  emitTabActivated({ tabId: 71, windowId: 3 });

  await flushAsyncWork();
  assert.equal(ports.length, 2);
  assert.equal(ports[0].port.disconnected, true);
  assert.equal(ports[1].tabId, 71);

  ports[1].port.emitMessage({
    payload: {
      supported: true,
      progressLabel: '9 / 18',
      headline: '当前字幕',
      description: '00:18.2 - 00:20.4 · 已重连到新的活动标签页。',
      currentText: '新的活动标签页字幕',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: false,
    },
  });

  assert.deepEqual(updates[1], {
    hostname: 'www.bilibili.com',
    subtitleNavigation: {
      supported: true,
      progressLabel: '9 / 18',
      headline: '当前字幕',
      description: '00:18.2 - 00:20.4 · 已重连到新的活动标签页。',
      currentText: '新的活动标签页字幕',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: false,
    },
  });

  ports[1].port.disconnect();

  assert.equal(updates[2].hostname, 'www.bilibili.com');
  assert.equal(updates[2].subtitleNavigation.supported, false);
  assert.match(
    updates[2].subtitleNavigation.description,
    /www\.bilibili\.com 当前还没有可用字幕导航/
  );

  unsubscribe();
});

test('react ui storage resilience: subscribeActiveTabSubtitleStatus should consume tabs.connect lastError on disconnect', async () => {
  const activeTab = {
    id: 70,
    url: 'https://www.bilibili.com/video/BV1shared',
  };
  const ports = [];
  const updates = [];
  let runtimeError = null;
  let runtimeErrorReads = 0;
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([cloneValue(activeTab)]);
    },
    tabsConnectImpl({ tabId, connectInfo, runtime }) {
      assert.equal(connectInfo.name, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE');
      Object.defineProperty(runtime, 'lastError', {
        configurable: true,
        enumerable: true,
        get() {
          runtimeErrorReads += 1;
          return runtimeError;
        },
        set(value) {
          runtimeError = value;
        },
      });

      const port = createMockPort(connectInfo.name);
      const originalDisconnect = port.disconnect;
      port.disconnect = () => {
        runtime.lastError = {
          message: 'Could not establish connection. Receiving end does not exist.',
        };
        originalDisconnect.call(port);
        runtime.lastError = null;
      };
      ports.push({ tabId, port });
      return port;
    },
  });

  const unsubscribe = storageModule.subscribeActiveTabSubtitleStatus((status) => {
    updates.push(cloneValue(status));
  });

  await flushAsyncWork();
  assert.equal(ports.length, 1);

  ports[0].port.disconnect();

  assert.equal(runtimeErrorReads, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].subtitleNavigation.supported, false);
  assert.match(
    updates[0].subtitleNavigation.description,
    /www\.bilibili\.com 当前还没有可用字幕导航/
  );

  unsubscribe();
});

test('react ui storage resilience: subscribeActiveTabSubtitleStatus should ignore stale port messages after reconnect', async () => {
  let activeTab = {
    id: 70,
    url: 'https://www.bilibili.com/video/BV1shared',
  };
  const ports = [];
  const updates = [];
  const { module: storageModule, emitTabActivated } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([cloneValue(activeTab)]);
    },
    tabsConnectImpl({ tabId, connectInfo }) {
      assert.equal(connectInfo.name, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE');
      const port = createMockPort(connectInfo.name);
      ports.push({ tabId, port });
      return port;
    },
  });

  const unsubscribe = storageModule.subscribeActiveTabSubtitleStatus((status) => {
    updates.push(cloneValue(status));
  });

  await flushAsyncWork();
  assert.equal(ports.length, 1);

  ports[0].port.emitMessage({
    payload: {
      supported: true,
      progressLabel: '5 / 18',
      headline: '当前字幕',
      description: '00:08.2 - 00:10.4 · 初始连接。',
      currentText: '旧标签页字幕',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: true,
    },
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].subtitleNavigation.currentText, '旧标签页字幕');

  activeTab = {
    id: 71,
    url: 'https://www.bilibili.com/video/BV1next',
  };
  emitTabActivated({ tabId: 71, windowId: 3 });

  await flushAsyncWork();
  assert.equal(ports.length, 2);
  assert.equal(ports[0].port.disconnected, true);

  ports[0].port.emitMessage({
    payload: {
      supported: true,
      progressLabel: '6 / 18',
      headline: '当前字幕',
      description: '00:10.5 - 00:12.0 · stale message should be ignored.',
      currentText: '旧 port 晚到字幕',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: true,
    },
  });

  assert.equal(updates.length, 1);

  ports[1].port.emitMessage({
    payload: {
      supported: true,
      progressLabel: '9 / 18',
      headline: '当前字幕',
      description: '00:18.2 - 00:20.4 · 已重连到新的活动标签页。',
      currentText: '新标签页字幕',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: false,
    },
  });

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[1], {
    hostname: 'www.bilibili.com',
    subtitleNavigation: {
      supported: true,
      progressLabel: '9 / 18',
      headline: '当前字幕',
      description: '00:18.2 - 00:20.4 · 已重连到新的活动标签页。',
      currentText: '新标签页字幕',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: false,
    },
  });

  unsubscribe();
});

test('react ui storage resilience: subscribeActiveTabSubtitleStatus should ignore stale port disconnect after reconnect', async () => {
  let activeTab = {
    id: 70,
    url: 'https://www.bilibili.com/video/BV1shared',
  };
  const ports = [];
  const updates = [];
  const { module: storageModule, emitTabActivated } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([cloneValue(activeTab)]);
    },
    tabsConnectImpl({ tabId, connectInfo }) {
      assert.equal(connectInfo.name, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE');
      const port = createMockPort(connectInfo.name);
      ports.push({ tabId, port });
      return port;
    },
  });

  const unsubscribe = storageModule.subscribeActiveTabSubtitleStatus((status) => {
    updates.push(cloneValue(status));
  });

  await flushAsyncWork();
  assert.equal(ports.length, 1);

  activeTab = {
    id: 71,
    url: 'https://www.bilibili.com/video/BV1next',
  };
  emitTabActivated({ tabId: 71, windowId: 3 });

  await flushAsyncWork();
  assert.equal(ports.length, 2);

  ports[1].port.emitMessage({
    payload: {
      supported: true,
      progressLabel: '9 / 18',
      headline: '当前字幕',
      description: '00:18.2 - 00:20.4 · 已重连到新的活动标签页。',
      currentText: '新标签页字幕',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: false,
    },
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].subtitleNavigation.currentText, '新标签页字幕');

  ports[0].port.disconnect();
  assert.equal(updates.length, 1);

  ports[1].port.disconnect();
  assert.equal(updates.length, 2);
  assert.equal(updates[1].hostname, 'www.bilibili.com');
  assert.equal(updates[1].subtitleNavigation.supported, false);
  assert.match(
    updates[1].subtitleNavigation.description,
    /www\.bilibili\.com 当前还没有可用字幕导航/
  );

  unsubscribe();
});

test('react ui storage resilience: subscribeActiveTabSubtitleStatus should ignore stale query result after newer reconnect wins', async () => {
  const staleTab = {
    id: 70,
    url: 'https://www.bilibili.com/video/BV1shared',
  };
  const freshTab = {
    id: 71,
    url: 'https://www.bilibili.com/video/BV1next',
  };
  const pendingQueries = [];
  const ports = [];
  const updates = [];
  const { module: storageModule, emitTabActivated } = createStorageModule({
    tabsQueryImpl({ callback }) {
      pendingQueries.push(callback);
    },
    tabsConnectImpl({ tabId, connectInfo }) {
      assert.equal(connectInfo.name, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE');
      const port = createMockPort(connectInfo.name);
      ports.push({ tabId, port });
      return port;
    },
  });

  const unsubscribe = storageModule.subscribeActiveTabSubtitleStatus((status) => {
    updates.push(cloneValue(status));
  });

  await flushAsyncWork();
  assert.equal(pendingQueries.length, 1);

  emitTabActivated({ tabId: 71, windowId: 3 });
  await flushAsyncWork();
  assert.equal(pendingQueries.length, 2);

  pendingQueries[1]([cloneValue(freshTab)]);
  await flushAsyncWork();
  assert.equal(ports.length, 1);
  assert.equal(ports[0].tabId, 71);

  ports[0].port.emitMessage({
    payload: {
      supported: true,
      progressLabel: '9 / 18',
      headline: '当前字幕',
      description: '00:18.2 - 00:20.4 · 新 reconnect 已接管。',
      currentText: '新标签页字幕',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: false,
    },
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].subtitleNavigation.currentText, '新标签页字幕');

  pendingQueries[0]([cloneValue(staleTab)]);
  await flushAsyncWork();

  assert.equal(ports.length, 1);
  assert.equal(ports[0].port.disconnected, false);
  assert.equal(updates.length, 1);

  unsubscribe();
});

test('react ui storage resilience: subscribeActiveTabSubtitleStatus should ignore stale empty query fallback after newer reconnect wins', async () => {
  const freshTab = {
    id: 71,
    url: 'https://www.bilibili.com/video/BV1next',
  };
  const pendingQueries = [];
  const ports = [];
  const updates = [];
  const { module: storageModule, emitTabActivated } = createStorageModule({
    tabsQueryImpl({ callback }) {
      pendingQueries.push(callback);
    },
    tabsConnectImpl({ tabId, connectInfo }) {
      assert.equal(connectInfo.name, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE');
      const port = createMockPort(connectInfo.name);
      ports.push({ tabId, port });
      return port;
    },
  });

  const unsubscribe = storageModule.subscribeActiveTabSubtitleStatus((status) => {
    updates.push(cloneValue(status));
  });

  await flushAsyncWork();
  assert.equal(pendingQueries.length, 1);

  emitTabActivated({ tabId: 71, windowId: 3 });
  await flushAsyncWork();
  assert.equal(pendingQueries.length, 2);

  pendingQueries[1]([cloneValue(freshTab)]);
  await flushAsyncWork();
  assert.equal(ports.length, 1);
  assert.equal(ports[0].tabId, 71);

  ports[0].port.emitMessage({
    payload: {
      supported: true,
      progressLabel: '9 / 18',
      headline: '当前字幕',
      description: '00:18.2 - 00:20.4 · 新 reconnect 已接管。',
      currentText: '新标签页字幕',
      canGoPrevious: true,
      canReplay: true,
      canGoNext: false,
    },
  });
  assert.equal(updates.length, 1);

  pendingQueries[0]([]);
  await flushAsyncWork();

  assert.equal(ports.length, 1);
  assert.equal(ports[0].port.disconnected, false);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].subtitleNavigation.currentText, '新标签页字幕');

  unsubscribe();
});

test('react ui storage resilience: readActiveTabSubtitleNavigation should fallback when tab bridge is unavailable', async () => {
  let tabsQueryCalls = 0;
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      tabsQueryCalls += 1;
      callback([
        {
          id: 8,
          url: 'https://www.youtube.com/watch?v=demo',
        },
      ]);
    },
    tabsSendMessageImpl({ callback, runtime }) {
      runtime.lastError = {
        message: 'Could not establish connection. Receiving end does not exist.',
      };
      callback(undefined);
      runtime.lastError = null;
    },
  });

  const snapshot = cloneValue(await storageModule.readActiveTabSubtitleNavigation());

  assert.equal(tabsQueryCalls, 1);
  assert.equal(snapshot.supported, false);
  assert.equal(snapshot.progressLabel, '未连接');
  assert.match(snapshot.description, /youtube\.com 当前还没有可用字幕导航/);
});

test('react ui storage resilience: readActiveTabSitePermissionState should treat default hosts as authorized', async () => {
  let containsCalls = 0;
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([
        {
          id: 12,
          url: 'https://www.bilibili.com/video/BV1permission',
        },
      ]);
    },
    permissionsContainsImpl() {
      containsCalls += 1;
    },
  });

  const state = cloneValue(await storageModule.readActiveTabSitePermissionState());

  assert.equal(containsCalls, 0);
  assert.deepEqual(state, {
    hostname: 'www.bilibili.com',
    originPattern: 'https://www.bilibili.com/*',
    defaultSupported: true,
    authorized: true,
    canRequest: false,
    canRevoke: false,
    message: '默认支持站点已随扩展安装授权。',
  });
});

test('react ui storage resilience: readActiveTabSitePermissionState should read optional permission for non-default hosts', async () => {
  const seenPermissions = [];
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([
        {
          id: 13,
          url: 'https://learn.example.com/article',
        },
      ]);
    },
    permissionsContainsImpl({ permission, callback }) {
      seenPermissions.push(cloneValue(permission));
      callback(true);
    },
  });

  const state = cloneValue(await storageModule.readActiveTabSitePermissionState());

  assert.deepEqual(seenPermissions, [{ origins: ['https://learn.example.com/*'] }]);
  assert.deepEqual(state, {
    hostname: 'learn.example.com',
    originPattern: 'https://learn.example.com/*',
    defaultSupported: false,
    authorized: true,
    canRequest: false,
    canRevoke: true,
    message: '当前站点已获得 optional host permission。',
  });
});

test('react ui storage resilience: requestActiveTabSitePermission should keep site unauthorized when user refuses', async () => {
  const requestedPermissions = [];
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([
        {
          id: 14,
          url: 'https://docs.example.com/page',
        },
      ]);
    },
    permissionsContainsImpl({ callback }) {
      callback(false);
    },
    permissionsRequestImpl({ permission, callback }) {
      requestedPermissions.push(cloneValue(permission));
      callback(false);
    },
  });

  const state = cloneValue(await storageModule.requestActiveTabSitePermission());

  assert.deepEqual(requestedPermissions, [{ origins: ['https://docs.example.com/*'] }]);
  assert.equal(state.authorized, false);
  assert.equal(state.canRequest, true);
  assert.equal(state.canRevoke, false);
  assert.equal(state.message, '用户未授予当前站点权限，站点规则保持不变。');
});

test('react ui storage resilience: requestActiveTabSitePermission should report granted optional host permission', async () => {
  const insertedCss = [];
  const executedScripts = [];
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([
        {
          id: 15,
          url: 'https://reader.example.org/page',
        },
      ]);
    },
    permissionsContainsImpl({ callback }) {
      callback(false);
    },
    permissionsRequestImpl({ callback }) {
      callback(true);
    },
    scriptingInsertCssImpl({ injection, callback }) {
      insertedCss.push(cloneValue(injection));
      callback();
    },
    scriptingExecuteScriptImpl({ injection, callback }) {
      executedScripts.push(cloneValue(injection));
      callback([]);
    },
  });

  const state = cloneValue(await storageModule.requestActiveTabSitePermission());

  assert.deepEqual(insertedCss, [
    {
      target: { tabId: 15 },
      files: ['styles.css'],
    },
  ]);
  assert.equal(executedScripts.length, 1);
  assert.deepEqual(executedScripts[0].target, { tabId: 15 });
  const runtimeFiles = executedScripts[0].files;
  assert.equal(runtimeFiles.includes('overlaySubtitleNavigationBridge.js'), true);
  assert.equal(runtimeFiles.includes('subtitleNavigationController.js'), true);
  assert.equal(runtimeFiles.includes('runtimeSettingsSync.js'), true);
  assert.equal(runtimeFiles.includes('webTextReplacement.js'), true);
  assert.equal(runtimeFiles.includes('overlayLoader.js'), true);
  assert.ok(
    runtimeFiles.indexOf('overlaySubtitleNavigationBridge.js') <
      runtimeFiles.indexOf('subtitleNavigationController.js')
  );
  assert.ok(runtimeFiles.indexOf('subtitleNavigationController.js') < runtimeFiles.length - 1);
  assert.equal(runtimeFiles.at(-1), 'contentScript.js');
  assert.equal(runtimeFiles.includes('dist/overlay.js'), false);
  assert.equal(state.hostname, 'reader.example.org');
  assert.equal(state.originPattern, 'https://reader.example.org/*');
  assert.equal(state.authorized, true);
  assert.equal(state.canRequest, false);
  assert.equal(state.canRevoke, true);
  assert.equal(state.message, '已获得当前站点授权，并已注入当前页面。');
});

test('react ui storage resilience: removeActiveTabSitePermission should revoke optional host permission', async () => {
  const removedPermissions = [];
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([
        {
          id: 16,
          url: 'https://reader.example.org/page',
        },
      ]);
    },
    permissionsContainsImpl({ callback }) {
      callback(true);
    },
    permissionsRemoveImpl({ permission, callback }) {
      removedPermissions.push(cloneValue(permission));
      callback(true);
    },
  });

  const state = cloneValue(await storageModule.removeActiveTabSitePermission());

  assert.deepEqual(removedPermissions, [{ origins: ['https://reader.example.org/*'] }]);
  assert.equal(state.hostname, 'reader.example.org');
  assert.equal(state.originPattern, 'https://reader.example.org/*');
  assert.equal(state.authorized, false);
  assert.equal(state.canRequest, true);
  assert.equal(state.canRevoke, false);
  assert.equal(state.message, '已撤销当前站点授权；当前页面刷新后会完全停止运行。');
});

test('react ui storage resilience: navigateActiveTabSubtitle should relay action to active tab', async () => {
  const { module: storageModule } = createStorageModule({
    tabsQueryImpl({ callback }) {
      callback([
        {
          id: 9,
          url: 'https://www.bilibili.com/video/BV1demo',
        },
      ]);
    },
    tabsSendMessageImpl({ message, callback, runtime }) {
      runtime.lastError = null;
      assert.equal(message.type, 'BILI_VOCAB_ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE');
      assert.equal(message.payload.action, 'next');
      callback({
        ok: true,
        payload: {
          supported: true,
          progressLabel: '13 / 48',
          headline: '当前字幕',
          description: '00:18.5 - 00:20.1 · 可直接回看上一句或跳到下一句。',
          currentText: '下一句字幕',
          canGoPrevious: true,
          canReplay: true,
          canGoNext: true,
        },
      });
    },
  });

  const snapshot = cloneValue(await storageModule.navigateActiveTabSubtitle('next'));

  assert.equal(snapshot.progressLabel, '13 / 48');
  assert.equal(snapshot.currentText, '下一句字幕');
  assert.equal(snapshot.canGoNext, true);
});
