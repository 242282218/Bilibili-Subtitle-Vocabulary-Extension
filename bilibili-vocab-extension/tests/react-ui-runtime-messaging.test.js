const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'runtime-messaging.ts');

function loadReactRuntimeMessagingModule(options = {}) {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleRef = { exports: {} };
  const chrome = options.chrome;
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    console,
  };

  if (chrome) {
    sandbox.chrome = chrome;
  }

  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'runtime-messaging.js' });
  return moduleRef.exports;
}

test('react ui runtime messaging: should expose the shipped message type constants', () => {
  const runtimeMessaging = loadReactRuntimeMessagingModule();

  assert.equal(runtimeMessaging.MESSAGE_TYPES.SETTINGS_COMMIT, 'BILI_VOCAB_SETTINGS_COMMIT');
  assert.equal(
    runtimeMessaging.MESSAGE_TYPES.EXPERIENCE_RECORD_EVENT,
    'BILI_VOCAB_EXPERIENCE_RECORD_EVENT'
  );
});

test('react ui runtime messaging: should reject when chrome runtime bridge is unavailable', async () => {
  const runtimeMessaging = loadReactRuntimeMessagingModule();

  await assert.rejects(
    runtimeMessaging.sendRuntimeMessage('BILI_VOCAB_SETTINGS_COMMIT', {}),
    /chrome\.runtime\.sendMessage unavailable/
  );
});

test('react ui runtime messaging: should resolve payload on success', async () => {
  const runtimeMessaging = loadReactRuntimeMessagingModule({
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          callback({
            ok: true,
            payload: {
              echoed: message.type,
            },
          });
        },
      },
    },
  });

  const payload = await runtimeMessaging.sendRuntimeMessage('BILI_VOCAB_SETTINGS_COMMIT', {
    now: 1,
  });

  assert.deepEqual(payload, {
    echoed: 'BILI_VOCAB_SETTINGS_COMMIT',
  });
});

test('react ui runtime messaging: should surface chrome.runtime.lastError with fallback text', async () => {
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        chrome.runtime.lastError = {};
        callback(undefined);
        chrome.runtime.lastError = null;
      },
    },
  };
  const runtimeMessaging = loadReactRuntimeMessagingModule({ chrome });

  await assert.rejects(
    runtimeMessaging.sendRuntimeMessage('BILI_VOCAB_SETTINGS_COMMIT', {}),
    /chrome\.runtime\.sendMessage failed/
  );
});

test('react ui runtime messaging: should reject malformed responses with bridge fallback text', async () => {
  const runtimeMessaging = loadReactRuntimeMessagingModule({
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(_message, callback) {
          callback({ ok: false });
        },
      },
    },
  });

  await assert.rejects(
    runtimeMessaging.sendRuntimeMessage('BILI_VOCAB_SETTINGS_COMMIT', {}),
    /runtime bridge failed/
  );
});
