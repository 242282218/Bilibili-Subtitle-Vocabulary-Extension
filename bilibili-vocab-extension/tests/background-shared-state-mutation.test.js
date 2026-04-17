const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sharedSettings = require('../sharedSettings.js');

const backgroundPath = path.join(__dirname, '..', 'background.js');
const experienceMetricsPath = path.join(__dirname, '..', 'experienceMetrics.js');
const storageSourcePath = path.join(__dirname, '..', 'react-ui', 'src', 'storage.ts');
const storageSourceDir = path.dirname(storageSourcePath);
const SETTINGS_STORAGE_KEY_V3 = 'bili_vocab_settings_v3';
const ADAPTIVE_TUNING_STORAGE_KEY = 'bili_vocab_adaptive_tuning_v1';
const EXPERIENCE_METRICS_STORAGE_KEY = 'bili_vocab_experience_metrics_v1';

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function createChromeStub(storageState) {
  const listeners = {
    installed: null,
    startup: null,
    command: null,
    message: null,
  };
  const runtime = {
    lastError: null,
    onInstalled: {
      addListener(listener) {
        listeners.installed = listener;
      },
    },
    onStartup: {
      addListener(listener) {
        listeners.startup = listener;
      },
    },
    onMessage: {
      addListener(listener) {
        listeners.message = listener;
      },
    },
    openOptionsPage() {
      return Promise.resolve();
    },
    sendMessage(message, callback) {
      if (typeof listeners.message !== 'function') {
        runtime.lastError = { message: 'no background listener' };
        if (typeof callback === 'function') {
          callback(undefined);
        }
        runtime.lastError = null;
        return;
      }

      try {
        listeners.message(message, { id: 'test-sender' }, (response) => {
          if (typeof callback === 'function') {
            callback(response);
          }
        });
      } catch (error) {
        runtime.lastError = { message: String(error && error.message ? error.message : error) };
        if (typeof callback === 'function') {
          callback(undefined);
        }
        runtime.lastError = null;
      }
    },
  };

  return {
    chrome: {
      runtime,
      commands: {
        onCommand: {
          addListener(listener) {
            listeners.command = listener;
          },
        },
      },
      tabs: {
        query(_query, callback) {
          callback([]);
        },
        sendMessage() {
          return undefined;
        },
      },
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
          remove() {},
        },
      },
    },
    listeners,
  };
}

function loadStorageModule(chrome) {
  const source = fs.readFileSync(storageSourcePath, 'utf8');
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
      if (id === './runtime-messaging') {
        return {
          MESSAGE_TYPES: {
            SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
            ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
          },
          sendRuntimeMessage(type, payload) {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type, payload }, (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
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
        return require(path.resolve(storageSourceDir, id));
      }
      return require(id);
    },
    chrome,
    Date,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'storage.js' });
  return moduleRef.exports;
}

async function withBackground(storageState, run) {
  const previousChrome = global.chrome;
  const stub = createChromeStub(storageState);

  delete require.cache[require.resolve(backgroundPath)];
  delete require.cache[require.resolve(experienceMetricsPath)];

  try {
    global.chrome = stub.chrome;
    require(backgroundPath);
    const storageModule = loadStorageModule(stub.chrome);
    const experienceMetrics = require(experienceMetricsPath);
    await run({ storageModule, experienceMetrics, storageState, listeners: stub.listeners });
  } finally {
    delete require.cache[require.resolve(backgroundPath)];
    delete require.cache[require.resolve(experienceMetricsPath)];
    global.chrome = previousChrome;
  }
}

test('background shared state mutation: react save should preserve existing metrics events', async () => {
  const storageState = {
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      enabled: true,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: {
      schemaVersion: 1,
      updatedAt: 1700000000000,
      counters: {
        adaptiveManualOverride: 0,
      },
      daily: {},
      events: [{ type: 'context-misreplace', at: 1700000000000, severity: 'high' }],
    },
  };

  await withBackground(storageState, async ({ storageModule, storageState: nextStorageState }) => {
    await storageModule.saveSettingsV3({ schemaVersion: 3, activeProfileId: 'balanced' });

    assert.equal(nextStorageState[SETTINGS_STORAGE_KEY_V3].activeProfileId, 'balanced');
    assert.equal(
      nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride,
      1
    );
    assert.deepEqual(
      nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].events.map((item) => item.type),
      ['context-misreplace', 'adaptive-manual-override']
    );
  });
});

test('background shared state mutation: react save and runtime metrics should not lose each other', async () => {
  const storageState = {
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      enabled: true,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: {
      schemaVersion: 1,
      updatedAt: null,
      counters: {},
      daily: {},
      events: [],
    },
  };

  await withBackground(
    storageState,
    async ({ storageModule, experienceMetrics, storageState: nextStorageState }) => {
      await Promise.all([
        storageModule.saveSettingsV3({ schemaVersion: 3, activeProfileId: 'intensive' }),
        experienceMetrics.recordEvent('context-misreplace', {
          severity: 'high',
          now: 1700000005000,
        }),
      ]);

      assert.equal(nextStorageState[SETTINGS_STORAGE_KEY_V3].activeProfileId, 'intensive');
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride,
        1
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.contextMisreplaceReported,
        1
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.contextMisreplaceHigh,
        1
      );
      assert.deepEqual(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].events.map((item) => item.type).sort(),
        ['adaptive-manual-override', 'context-misreplace']
      );
    }
  );
});

test('background shared state mutation: keyboard command should serialize with metrics and mark manual override', async () => {
  const storageState = {
    [SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      enabled: true,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: {
      schemaVersion: 1,
      updatedAt: null,
      counters: {},
      daily: {},
      events: [],
    },
  };

  await withBackground(
    storageState,
    async ({ listeners, experienceMetrics, storageState: nextStorageState }) => {
      const baselineRatio =
        nextStorageState[SETTINGS_STORAGE_KEY_V3].profilesBuiltin.balanced.replaceRatio;

      await Promise.all([
        listeners.command('increase-ratio'),
        experienceMetrics.recordEvent('context-misreplace', {
          severity: 'high',
          now: 1700000005000,
        }),
      ]);

      assert.equal(
        nextStorageState[SETTINGS_STORAGE_KEY_V3].profilesBuiltin.balanced.replaceRatio,
        baselineRatio + 0.05
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride,
        1
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.contextMisreplaceReported,
        1
      );
      assert.equal(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.contextMisreplaceHigh,
        1
      );
      assert.deepEqual(
        nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].events.map((item) => item.type).sort(),
        ['adaptive-manual-override', 'context-misreplace']
      );
    }
  );
});

test('background shared state mutation: concurrent keyboard commands should build on latest settings', async () => {
  const storageState = {
    [SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
    [ADAPTIVE_TUNING_STORAGE_KEY]: {
      enabled: true,
    },
    [EXPERIENCE_METRICS_STORAGE_KEY]: {
      schemaVersion: 1,
      updatedAt: null,
      counters: {},
      daily: {},
      events: [],
    },
  };

  await withBackground(storageState, async ({ listeners, storageState: nextStorageState }) => {
    const baselineRatio =
      nextStorageState[SETTINGS_STORAGE_KEY_V3].profilesBuiltin.balanced.replaceRatio;

    await Promise.all([listeners.command('increase-ratio'), listeners.command('increase-ratio')]);

    assert.equal(
      nextStorageState[SETTINGS_STORAGE_KEY_V3].profilesBuiltin.balanced.replaceRatio,
      Number((baselineRatio + 0.1).toFixed(2))
    );
    assert.equal(
      nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride,
      2
    );
    assert.equal(
      nextStorageState[EXPERIENCE_METRICS_STORAGE_KEY].events.filter(
        (item) => item.type === 'adaptive-manual-override'
      ).length,
      2
    );
  });
});
