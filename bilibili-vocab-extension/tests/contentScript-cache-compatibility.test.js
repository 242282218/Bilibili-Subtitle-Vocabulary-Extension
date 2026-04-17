const test = require('node:test');
const assert = require('node:assert/strict');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousUtils = global.Utils;

const contentScriptPath = require.resolve('../contentScript.js');

class MinimalLruCache {
  constructor(maxSize) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value) {
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }
}

function loadContentScriptWithMinimalCache() {
  delete require.cache[contentScriptPath];
  global.Utils = {
    LRUCache: MinimalLruCache,
  };
  return require('../contentScript.js');
}

test.before(() => {
  global.document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector() {
      return null;
    },
    body: {},
  };

  global.chrome = {
    storage: {
      local: {
        get(_defaults, callback) {
          callback({});
        },
      },
      onChanged: {
        addListener() {},
      },
    },
  };
});

test('contentScript cache compatibility: repeated writes should work with minimal LRUCache API', () => {
  const contentScript = loadContentScriptWithMinimalCache();
  const firstResult = { tokens: [{ type: 'word', word: 'first' }] };
  const secondResult = { tokens: [{ type: 'word', word: 'second' }] };

  contentScript.__clearTranslationCacheForTest();
  assert.doesNotThrow(() => {
    contentScript.__writeToCacheForTest('same-key', firstResult);
    contentScript.__writeToCacheForTest('same-key', secondResult);
  });
  assert.deepEqual(contentScript.__readFromCacheForTest('same-key'), secondResult);
});

test.after(() => {
  delete require.cache[contentScriptPath];
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.Utils = previousUtils;
});
