const test = require("node:test");
const assert = require("node:assert/strict");

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousVocabularyModule = global.VocabularyModule;

global.document = {
  readyState: "loading",
  addEventListener() {},
  querySelector() {
    return null;
  },
  body: {}
};

global.chrome = {
  storage: {
    local: {
      get(_defaults, callback) {
        callback({});
      }
    },
    onChanged: {
      addListener() {}
    }
  }
};

const contentScript = require("../contentScript.js");

test("recordRenderedHits: should not record duplicate hits for the same source text and rendered words", () => {
  const calls = [];
  global.VocabularyModule = {
    recordHit(word) {
      calls.push(word);
    }
  };

  const element = { dataset: {} };
  const result = {
    tokens: [
      { type: "word", word: "pyramid" },
      { type: "text", text: " " },
      { type: "word", word: "structure" }
    ]
  };

  contentScript.recordRenderedHits(element, result, "金字塔结构");
  contentScript.recordRenderedHits(element, result, "金字塔结构");

  assert.deepEqual(calls, ["pyramid", "structure"]);
});

test("resetHitTrackingIfSourceChanged: should clear hit signature only when subtitle source text changes", () => {
  const element = {
    dataset: {
      biliVocabOriginalText: "旧字幕",
      biliVocabHitSignature: "old-signature"
    }
  };

  contentScript.resetHitTrackingIfSourceChanged(element, "旧字幕");
  assert.equal(element.dataset.biliVocabHitSignature, "old-signature");

  contentScript.resetHitTrackingIfSourceChanged(element, "新字幕");
  assert.equal("biliVocabHitSignature" in element.dataset, false);
});

test("shouldRunReviewDanmaku: should only run when trigger is enabled and video is playing", () => {
  assert.equal(
    contentScript.shouldRunReviewDanmaku(
      { reviewDanmakuEnabled: false },
      { hasVideo: true, paused: false, ended: false }
    ),
    false
  );

  assert.equal(
    contentScript.shouldRunReviewDanmaku(
      { reviewDanmakuEnabled: true },
      { hasVideo: false, paused: false, ended: false }
    ),
    false
  );

  assert.equal(
    contentScript.shouldRunReviewDanmaku(
      { reviewDanmakuEnabled: true },
      { hasVideo: true, paused: true, ended: false }
    ),
    false
  );

  assert.equal(
    contentScript.shouldRunReviewDanmaku(
      { reviewDanmakuEnabled: true },
      { hasVideo: true, paused: false, ended: true }
    ),
    false
  );

  assert.equal(
    contentScript.shouldRunReviewDanmaku(
      { reviewDanmakuEnabled: true },
      { hasVideo: true, paused: false, ended: false }
    ),
    true
  );
});

test("isRenderUpToDate: should skip rerender when source text and settings fingerprint are unchanged", () => {
  const settings = {
    enabled: true,
    activeLevels: ["CET4", "IELTS"],
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: "B2"
  };

  const signature = contentScript.createRenderSignature("source subtitle", settings);
  const element = {
    dataset: {
      biliVocabRenderSignature: signature
    }
  };

  assert.equal(
    contentScript.isRenderUpToDate(element, "source subtitle", settings),
    true
  );

  assert.equal(
    contentScript.isRenderUpToDate(element, "changed subtitle", settings),
    false
  );

  assert.equal(
    contentScript.isRenderUpToDate(element, "source subtitle", {
      ...settings,
      replaceRatio: 0.3
    }),
    false
  );
});

test.after(() => {
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.VocabularyModule = previousVocabularyModule;
});
