const test = require("node:test");
const assert = require("node:assert/strict");

const learningStatePath = require.resolve("../learningState.js");

function loadLearningStateModule() {
  delete require.cache[learningStatePath];
  return require(learningStatePath);
}

test("learning state storage: saveWordToVocabularyBook should fail when storage read fails", async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const runtime = { lastError: null };
  const setCalls = [];

  globalThis.Utils = { logError() {} };
  globalThis.chrome = {
    runtime,
    storage: {
      local: {
        get(_keys, callback) {
          runtime.lastError = { message: "mock read failed" };
          callback({});
          runtime.lastError = null;
        },
        set(payload, callback) {
          setCalls.push(payload);
          runtime.lastError = null;
          callback();
        }
      }
    }
  };

  t.after(() => {
    delete require.cache[learningStatePath];
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const learningState = loadLearningStateModule();
  const success = await learningState.saveWordToVocabularyBook("retain", {
    meaning: "记住",
    level: "CET6"
  });

  assert.equal(success, false);
  assert.equal(setCalls.length, 0);
});

test("learning state storage: saveWordToVocabularyBook should keep local cache unchanged when storage write fails", async (t) => {
  const previousChrome = globalThis.chrome;
  const previousUtils = globalThis.Utils;
  const runtime = { lastError: null };

  globalThis.Utils = { logError() {} };
  globalThis.chrome = {
    runtime,
    storage: {
      local: {
        get(_keys, callback) {
          runtime.lastError = null;
          callback({});
        },
        set(_payload, callback) {
          runtime.lastError = { message: "mock write failed" };
          callback();
          runtime.lastError = null;
        }
      }
    }
  };

  t.after(() => {
    delete require.cache[learningStatePath];
    globalThis.chrome = previousChrome;
    globalThis.Utils = previousUtils;
  });

  const learningState = loadLearningStateModule();
  const success = await learningState.saveWordToVocabularyBook("retain", {
    meaning: "记住",
    level: "CET6"
  });

  assert.equal(success, false);
  assert.deepEqual(learningState.getVocabularyBookWords(), []);
});
