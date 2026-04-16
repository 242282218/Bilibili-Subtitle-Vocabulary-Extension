const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const STORAGE_SOURCE_PATH = path.join(__dirname, "..", "react-ui", "src", "storage.ts");
const SETTINGS_STORAGE_KEY_V3 = "bili_vocab_settings_v3";
const ADAPTIVE_TUNING_STORAGE_KEY = "bili_vocab_adaptive_tuning_v1";
const EXPERIENCE_METRICS_STORAGE_KEY = "bili_vocab_experience_metrics_v1";

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

function createStorageModule(options = {}) {
  const source = fs.readFileSync(STORAGE_SOURCE_PATH, "utf8");
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
  };
  const moduleRef = { exports: {} };
  const MockDate = createMockDate(options.now || 1700000000000);
  const chrome = {
    storage: {
      local: {
        get(keys, callback) {
          if (typeof options.getImpl === "function") {
            options.getImpl({ keys, callback, state: storageState, runtime });
            return;
          }
          callback(pickPayload(storageState, keys));
        },
        set(payload, callback) {
          if (typeof options.setImpl === "function") {
            options.setImpl({ payload, callback, state: storageState, runtime });
            return;
          }
          Object.assign(storageState, cloneValue(payload));
          if (typeof callback === "function") {
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
      if (id === "./settings-bridge") {
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

  vm.runInNewContext(transpiled, sandbox, { filename: "storage.js" });
  return {
    module: moduleRef.exports,
    storageState,
    runtime,
  };
}

test("react ui storage resilience: readStorage should reject on chrome runtime read error", async () => {
  const { module: storageModule } = createStorageModule({
    getImpl({ callback, runtime }) {
      runtime.lastError = { message: "storage unavailable" };
      callback(undefined);
      runtime.lastError = null;
    },
  });

  await assert.rejects(storageModule.readStorage(null), /storage unavailable/);
});

test("react ui storage resilience: loadSettingsV3 should not overwrite storage after read failure", async () => {
  let setCalls = 0;
  const { module: storageModule } = createStorageModule({
    getImpl({ callback, runtime }) {
      runtime.lastError = { message: "storage unavailable" };
      callback(undefined);
      runtime.lastError = null;
    },
    setImpl({ callback }) {
      setCalls += 1;
      if (typeof callback === "function") {
        callback();
      }
    },
  });

  await assert.rejects(storageModule.loadSettingsV3(), /storage unavailable/);
  assert.equal(setCalls, 0);
});

test("react ui storage resilience: concurrent saveSettingsV3 should preserve manual override metrics", async () => {
  const now = 1700000000000;
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const { module: storageModule, storageState } = createStorageModule({
    now,
    initialState: {
      [ADAPTIVE_TUNING_STORAGE_KEY]: {
        enabled: true,
      },
      [EXPERIENCE_METRICS_STORAGE_KEY]: {
        schemaVersion: 1,
        updatedAt: null,
        counters: {
          adaptiveManualOverride: 0,
        },
        daily: {},
      },
    },
    getImpl({ keys, callback, state, runtime }) {
      setTimeout(() => {
        runtime.lastError = null;
        callback(pickPayload(state, keys));
      }, 5);
    },
    setImpl({ payload, callback, state, runtime }) {
      setTimeout(() => {
        runtime.lastError = null;
        Object.assign(state, cloneValue(payload));
        if (typeof callback === "function") {
          callback();
        }
      }, 5);
    },
  });

  await Promise.all([
    storageModule.saveSettingsV3({ schemaVersion: 3, activeProfileId: "gentle" }),
    storageModule.saveSettingsV3({ schemaVersion: 3, activeProfileId: "balanced" }),
  ]);

  assert.equal(storageState[SETTINGS_STORAGE_KEY_V3].activeProfileId, "balanced");
  assert.equal(
    storageState[EXPERIENCE_METRICS_STORAGE_KEY].counters.adaptiveManualOverride,
    2
  );
  assert.equal(
    storageState[EXPERIENCE_METRICS_STORAGE_KEY].daily[dayKey].adaptiveManualOverride,
    2
  );
});
