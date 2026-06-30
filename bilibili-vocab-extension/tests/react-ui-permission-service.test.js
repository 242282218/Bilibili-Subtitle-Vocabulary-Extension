const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const STORAGE_SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'lib', 'storage.ts');
const STORAGE_SOURCE_DIR = path.dirname(STORAGE_SOURCE_PATH);
const SETTINGS_STORAGE_KEY_V3 = 'bili_vocab_settings_v3';

function loadStorageModule(chrome) {
  const source = fs.readFileSync(STORAGE_SOURCE_PATH, 'utf8');
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
            return settings || {};
          },
        };
      }
      if (id === './learning-dashboard') {
        return {
          buildLearningDashboardSnapshot() {
            return {};
          },
        };
      }
      if (id === './chrome-storage-adapter') {
        return {
          readStorage(keys) {
            return new Promise((resolve, reject) => {
              chrome.storage.local.get(keys == null ? null : keys, (payload) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                resolve(payload || {});
              });
            });
          },
          writeStorage(payload) {
            return new Promise((resolve, reject) => {
              chrome.storage.local.set(payload, () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                resolve();
              });
            });
          },
        };
      }
      if (id === './runtime-messaging') {
        return {
          MESSAGE_TYPES: {
            SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
            ADAPTIVE_PERSIST_FEEDBACK: 'BILI_VOCAB_ADAPTIVE_PERSIST_FEEDBACK',
            ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
            LEARNING_APPLY_REVIEW_FEEDBACK: 'BILI_VOCAB_LEARNING_APPLY_REVIEW_FEEDBACK',
          },
          sendRuntimeMessage(_type, _payload, storageKeys = []) {
            if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
              if (storageKeys.length > 0) {
                return new Promise((resolve) => {
                  chrome.storage.local.get(storageKeys, resolve);
                });
              }
              return Promise.reject(new Error('chrome.runtime.sendMessage unavailable'));
            }
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: _type, payload: _payload }, (response) => {
                if (chrome.runtime.lastError) {
                  if (storageKeys.length > 0) {
                    chrome.storage.local.get(storageKeys, resolve);
                    return;
                  }
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                resolve(response && response.payload);
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

function createPermissionChromeStub(tabUrl, options = {}) {
  const sentMessages = [];
  const removedOrigins = [];
  const runtime = {
    lastError: null,
  };
  const chrome = {
    runtime,
    tabs: {
      query(_query, callback) {
        callback([{ id: 42, url: tabUrl }]);
      },
      sendMessage(tabId, message, callback) {
        sentMessages.push({ tabId, message });
        if (options.teardownFails) {
          runtime.lastError = { message: 'receiver missing' };
          callback(undefined);
          runtime.lastError = null;
          return;
        }
        callback({ ok: true, payload: { stopped: true } });
      },
    },
    permissions: {
      contains(request, callback) {
        callback(request.origins[0] === 'https://example.com/*');
      },
      request(_request, callback) {
        callback(true);
      },
      remove(request, callback) {
        removedOrigins.push(request.origins[0]);
        callback(true);
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          const payload = Array.isArray(keys)
            ? keys.reduce((result, key) => {
                result[key] = { schemaVersion: 3, activeProfileId: 'fallback' };
                return result;
              }, {})
            : {};
          callback(payload);
        },
        set(_payload, callback) {
          if (typeof callback === 'function') {
            callback();
          }
        },
      },
    },
  };

  return { chrome, sentMessages, removedOrigins };
}

test('permission service: removing optional host permission should teardown active tab runtime', async () => {
  const { chrome, sentMessages, removedOrigins } = createPermissionChromeStub(
    'https://example.com/article'
  );
  const storage = loadStorageModule(chrome);

  const state = await storage.removeActiveTabSitePermission();

  assert.equal(state.authorized, false);
  assert.equal(state.canRevoke, false);
  assert.match(state.message, /已停止当前页面运行/);
  assert.deepEqual(removedOrigins, ['https://example.com/*']);
  assert.deepEqual(JSON.parse(JSON.stringify(sentMessages)), [
    {
      tabId: 42,
      message: {
        type: 'BILI_VOCAB_CONTENT_TEARDOWN',
        payload: {},
      },
    },
  ]);
});

test('permission service: optional host permission should only target HTTPS pages', async () => {
  const { chrome, sentMessages, removedOrigins } = createPermissionChromeStub(
    'http://example.com/article'
  );
  const storage = loadStorageModule(chrome);

  const state = await storage.readActiveTabSitePermissionState();

  assert.equal(state.canRequest, false);
  assert.equal(state.canRevoke, false);
  assert.match(state.message, /HTTPS/);
  assert.deepEqual(removedOrigins, []);
  assert.deepEqual(sentMessages, []);
});

test('react storage writes: saveSettingsV3 should reject when runtime write fails', async () => {
  const { chrome } = createPermissionChromeStub('https://example.com/article');
  const storage = loadStorageModule(chrome);

  await assert.rejects(
    storage.saveSettingsV3({ schemaVersion: 3, activeProfileId: 'balanced' }),
    /chrome\.runtime\.sendMessage unavailable/
  );
});
