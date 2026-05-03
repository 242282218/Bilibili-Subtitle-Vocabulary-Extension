const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sharedSettings = require('../sharedSettings.js');

const backgroundPath = path.join(__dirname, '..', 'background.js');

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createChromeStub({ storageState, shouldFailSet, sendMessageImpl }) {
  const listeners = {
    installed: null,
    startup: null,
    command: null,
  };
  const removedKeys = [];
  const sentMessages = [];
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
          callback([{ id: 7, url: 'https://www.bilibili.com/video/BV1xx411c7mD' }]);
        },
        sendMessage(tabId, message, callback) {
          sentMessages.push({ tabId, message });
          if (typeof sendMessageImpl === 'function') {
            return sendMessageImpl(tabId, message, callback, runtime);
          }
          return undefined;
        },
      },
      storage: {
        local: {
          get(_keys, callback) {
            callback({ ...storageState });
          },
          set(payload, callback) {
            const failed = typeof shouldFailSet === 'function' ? shouldFailSet(payload) : false;
            if (!failed) {
              Object.assign(storageState, payload);
            }
            runtime.lastError = failed ? { message: 'mock set failure' } : null;
            if (typeof callback === 'function') {
              callback();
            }
            runtime.lastError = null;
          },
          remove(keys) {
            removedKeys.push(Array.isArray(keys) ? keys.slice() : [keys]);
          },
        },
      },
    },
    listeners,
    removedKeys,
    sentMessages,
    storageState,
  };
}

async function withBackgroundRuntime(options, run) {
  const previousChrome = global.chrome;
  const previousConsoleError = console.error;
  const stub = createChromeStub(options);
  const loggedErrors = [];

  try {
    global.chrome = stub.chrome;
    console.error = (...args) => {
      loggedErrors.push(args);
    };

    delete require.cache[require.resolve(backgroundPath)];
    const background = require(backgroundPath);
    await run({
      background,
      listeners: stub.listeners,
      removedKeys: stub.removedKeys,
      sentMessages: stub.sentMessages,
      storageState: stub.storageState,
      loggedErrors,
    });
  } finally {
    delete require.cache[require.resolve(backgroundPath)];
    global.chrome = previousChrome;
    console.error = previousConsoleError;
  }
}

test('ensureDefaultSettings: should keep legacy keys when storage write fails', async () => {
  const storageState = {
    level: 'cet6',
    testDanmakuMode: true,
  };

  await withBackgroundRuntime(
    {
      storageState,
      shouldFailSet(payload) {
        return Object.prototype.hasOwnProperty.call(
          payload,
          sharedSettings.SETTINGS_STORAGE_KEY_V3
        );
      },
    },
    async ({ background, removedKeys, storageState: nextStorageState, loggedErrors }) => {
      background.ensureDefaultSettings();
      await flushAsync();

      assert.equal(removedKeys.length, 0);
      assert.equal(nextStorageState.level, 'cet6');
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          nextStorageState,
          sharedSettings.SETTINGS_STORAGE_KEY_V3
        ),
        false
      );
      assert.equal(loggedErrors.length, 1);
    }
  );
});

test('background command: should skip broadcast when storage write fails', async () => {
  const storageState = {
    [sharedSettings.SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
  };

  await withBackgroundRuntime(
    {
      storageState,
      shouldFailSet(payload) {
        return Object.prototype.hasOwnProperty.call(
          payload,
          sharedSettings.SETTINGS_STORAGE_KEY_V3
        );
      },
    },
    async ({ listeners, sentMessages, storageState: nextStorageState, loggedErrors }) => {
      await listeners.command('toggle-overlay');
      await flushAsync();

      assert.equal(sentMessages.length, 0);
      assert.equal(
        nextStorageState[sharedSettings.SETTINGS_STORAGE_KEY_V3].globalControls.overlayState.hidden,
        false
      );
      assert.equal(loggedErrors.length, 1);
    }
  );
});

test('background command: should consume tabs.sendMessage lastError when receiver is missing', async () => {
  const storageState = {
    [sharedSettings.SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
  };
  let runtimeError = null;
  let runtimeErrorReads = 0;

  await withBackgroundRuntime(
    {
      storageState,
      sendMessageImpl(_tabId, _message, callback, runtime) {
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
        runtime.lastError = {
          message: 'Could not establish connection. Receiving end does not exist.',
        };
        callback();
        runtime.lastError = null;
        return undefined;
      },
    },
    async ({ listeners, sentMessages, loggedErrors }) => {
      await listeners.command('toggle-overlay');
      await flushAsync();

      assert.equal(sentMessages.length, 1);
      assert.equal(runtimeErrorReads, 1);
      assert.equal(loggedErrors.length, 0);
    }
  );
});

test('background command: should tolerate callback-style tabs.sendMessage on success', async () => {
  const storageState = {
    [sharedSettings.SETTINGS_STORAGE_KEY_V3]: sharedSettings.getDefaultSettingsV3(),
  };

  await withBackgroundRuntime(
    {
      storageState,
      sendMessageImpl() {
        return undefined;
      },
    },
    async ({ listeners, sentMessages, storageState: nextStorageState, loggedErrors }) => {
      await listeners.command('toggle-overlay');
      await flushAsync();

      assert.equal(
        nextStorageState[sharedSettings.SETTINGS_STORAGE_KEY_V3].globalControls.overlayState.hidden,
        true
      );
      assert.deepEqual(sentMessages, [
        {
          tabId: 7,
          message: {
            type: 'SETTINGS_UPDATED',
            payload: nextStorageState[sharedSettings.SETTINGS_STORAGE_KEY_V3],
          },
        },
      ]);
      assert.equal(loggedErrors.length, 0);
    }
  );
});
