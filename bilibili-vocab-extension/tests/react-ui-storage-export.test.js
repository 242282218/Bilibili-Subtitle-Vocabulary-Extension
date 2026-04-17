const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const STORAGE_SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'storage.ts');
const STORAGE_SOURCE_DIR = path.dirname(STORAGE_SOURCE_PATH);

function createStorageModule(storagePayload) {
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
          SETTINGS_STORAGE_KEY_V3: 'bili_vocab_settings_v3',
          migrateToV3: (payload) => payload,
          normalizeSettingsV3: (settings) => settings,
        };
      }
      if (id === './runtime-messaging') {
        return {
          MESSAGE_TYPES: {
            SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
            ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
          },
          sendRuntimeMessage() {
            return Promise.reject(new Error('runtime bridge not used in export test'));
          },
        };
      }
      if (id.startsWith('.')) {
        return require(path.resolve(STORAGE_SOURCE_DIR, id));
      }
      return require(id);
    },
    chrome: {
      storage: {
        local: {
          get(_keys, callback) {
            callback(storagePayload);
          },
          set(_payload, callback) {
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
        query(_queryInfo, callback) {
          callback([]);
        },
      },
      runtime: {
        openOptionsPage() {
          return Promise.resolve();
        },
      },
    },
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

test('react ui storage export: should ignore malformed vocabulary records', async () => {
  const storageModule = createStorageModule({
    bili_vocab_word_stats_v2: {
      nullEntry: null,
      numberEntry: 42,
      badShape: { status: 'saved' },
      learningWord: { status: 'learning', word: 'draft' },
      olderSaved: {
        status: 'saved',
        word: 'alpha',
        savedAt: 1700000000000,
        exposures: 2,
        details: { meaning: 'A', level: 'CET4', phonetic: '/a/' },
      },
      latestSaved: {
        status: 'saved',
        word: 'beta',
        savedAt: 1800000000000,
        exposures: 5,
        details: { meaning: 'B', level: 'CET6', phonetic: '/b/' },
      },
    },
  });

  const jsonPayload = await storageModule.exportVocabularyBook('json');
  const words = JSON.parse(jsonPayload);
  assert.deepEqual(
    words.map((item) => item.word),
    ['beta', 'alpha']
  );
  assert.deepEqual(
    words.map((item) => item.status),
    ['saved', 'saved']
  );

  const csvPayload = await storageModule.exportVocabularyBook('csv');
  assert.match(csvPayload, /"beta"/);
  assert.match(csvPayload, /"alpha"/);
  assert.doesNotMatch(csvPayload, /"draft"/);

  const ankiPayload = await storageModule.exportVocabularyBook('anki');
  const [header, firstRow, secondRow] = ankiPayload.split('\n');
  assert.equal(header, 'Front\tBack\tLevel\tPhonetic\tSavedAt');
  assert.match(firstRow, /^beta\tB\tCET6\t\/b\/\t/);
  assert.match(secondRow, /^alpha\tA\tCET4\t\/a\/\t/);
  assert.doesNotMatch(ankiPayload, /draft/);
});
