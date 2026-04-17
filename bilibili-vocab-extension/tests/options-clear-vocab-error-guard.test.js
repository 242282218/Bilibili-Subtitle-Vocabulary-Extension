const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const VOCABULARY_BOOK_STORAGE_KEY = 'bili_vocab_word_stats_v2';

function createClassList() {
  return {
    add() {},
    remove() {},
    toggle() {},
  };
}

function createElementStub() {
  return {
    checked: false,
    value: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    classList: createClassList(),
    style: {},
    disabled: false,
    addEventListener() {},
    setAttribute() {},
    appendChild() {},
    removeChild() {},
    querySelector() {
      return null;
    },
  };
}

function createDocumentStub() {
  const nodes = new Map();
  const activeLevelNodes = ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'].map((value) => ({
    value,
    checked: value === 'CET4' || value === 'CET6',
    addEventListener() {},
  }));

  const getNode = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, createElementStub());
    }
    return nodes.get(id);
  };

  return {
    readyState: 'loading',
    body: {
      classList: createClassList(),
      dataset: {},
      appendChild() {},
      removeChild() {},
    },
    addEventListener() {},
    getElementById(id) {
      return getNode(id);
    },
    querySelectorAll(selector) {
      if (selector === '.hero-metric__meta') {
        return [createElementStub(), createElementStub(), createElementStub()];
      }
      if (selector === '.hub-scenario-card') {
        return [];
      }
      if (selector === 'input[name="activeLevels"]') {
        return activeLevelNodes;
      }
      if (selector === '.hub-reveal-target') {
        return [];
      }
      return [];
    },
    createElement() {
      return createElementStub();
    },
    __getNode(id) {
      return getNode(id);
    },
  };
}

function createChromeStorageStub(storageState) {
  const runtime = {
    lastError: null,
  };

  return {
    runtime,
    storage: {
      local: {
        get(keysOrDefaults, callback) {
          if (Array.isArray(keysOrDefaults)) {
            const result = {};
            keysOrDefaults.forEach((key) => {
              if (Object.prototype.hasOwnProperty.call(storageState, key)) {
                result[key] = storageState[key];
              }
            });
            callback(result);
            return;
          }

          if (keysOrDefaults && typeof keysOrDefaults === 'object') {
            callback({
              ...keysOrDefaults,
              ...storageState,
            });
            return;
          }

          callback({ ...storageState });
        },
        set(payload, callback) {
          const failed = Object.prototype.hasOwnProperty.call(payload, VOCABULARY_BOOK_STORAGE_KEY);
          if (!failed) {
            Object.assign(storageState, payload);
          }
          runtime.lastError = failed ? { message: 'mock set failure' } : null;
          if (typeof callback === 'function') {
            callback();
          }
          runtime.lastError = null;
        },
      },
    },
  };
}

test('options clear vocabulary: should keep data and show failure when storage write fails', async () => {
  const previousDocument = global.document;
  const previousChrome = global.chrome;
  const previousConfirm = global.confirm;
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  const optionsPath = path.join(__dirname, '..', 'options.js');

  const storageState = {
    [VOCABULARY_BOOK_STORAGE_KEY]: {
      focus: {
        word: 'focus',
        status: 'saved',
        savedAt: 1700000000000,
      },
    },
  };

  try {
    global.document = createDocumentStub();
    global.chrome = createChromeStorageStub(storageState);
    global.confirm = () => true;
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};

    delete require.cache[require.resolve(optionsPath)];
    const options = require(optionsPath);

    await options.clearVocabularyBook();

    assert.equal(storageState[VOCABULARY_BOOK_STORAGE_KEY].focus.status, 'saved');
    assert.equal(storageState[VOCABULARY_BOOK_STORAGE_KEY].focus.savedAt, 1700000000000);
    assert.equal(global.document.__getNode('toast').textContent, '清空失败，请重试');
  } finally {
    delete require.cache[require.resolve(optionsPath)];
    global.document = previousDocument;
    global.chrome = previousChrome;
    global.confirm = previousConfirm;
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});
