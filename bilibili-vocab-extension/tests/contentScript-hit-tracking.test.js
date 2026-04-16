const test = require("node:test");
const assert = require("node:assert/strict");

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousVocabularyModule = global.VocabularyModule;
const previousRequestAnimationFrame = global.requestAnimationFrame;
const previousLocation = global.location;
const previousHTMLVideoElement = global.HTMLVideoElement;
const previousSubtitleRenderer = global.SubtitleRenderer;

class FakeVideoElement {
  constructor({ paused = false, ended = false } = {}) {
    this.paused = paused;
    this.ended = ended;
    this.removedListeners = [];
  }

  addEventListener() {}

  removeEventListener(type) {
    this.removedListeners.push(type);
  }
}

global.HTMLVideoElement = FakeVideoElement;

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

test("bindVideoPlaybackEvents: should unbind stale video when current page has no video element", () => {
  const previousQuerySelector = global.document.querySelector;
  const video = new FakeVideoElement({ paused: false, ended: false });

  try {
    global.document.querySelector = (selector) => (selector === "video" ? video : null);
    contentScript.bindVideoPlaybackEvents();
    assert.deepEqual(contentScript.getPlaybackState(), {
      hasVideo: true,
      paused: false,
      ended: false
    });

    global.document.querySelector = () => null;
    contentScript.bindVideoPlaybackEvents();
    assert.deepEqual(contentScript.getPlaybackState(), {
      hasVideo: false,
      paused: true,
      ended: true
    });
    assert.deepEqual(video.removedListeners.sort(), ["ended", "pause", "play"]);
  } finally {
    global.document.querySelector = previousQuerySelector;
  }
});

test("isRenderUpToDate: should skip rerender when source text and settings fingerprint are unchanged", () => {
  const settings = {
    enabled: true,
    activeLevels: ["CET4", "IELTS"],
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: "B2",
    vocabularyMode: "core",
    examPreference: "balanced"
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

test("createRenderSignature: should include web page mode so page toggle triggers rerender", () => {
  const enabledSignature = contentScript.createRenderSignature("source subtitle", {
    enabled: true,
    webPageEnabled: true,
    activeLevels: ["CET4", "IELTS"],
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: "B2",
    vocabularyMode: "core",
    examPreference: "balanced"
  });

  const disabledSignature = contentScript.createRenderSignature("source subtitle", {
    enabled: true,
    webPageEnabled: false,
    activeLevels: ["CET4", "IELTS"],
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: "B2",
    vocabularyMode: "core",
    examPreference: "balanced"
  });

  assert.notEqual(enabledSignature, disabledSignature);
});

test("shouldReplaceWebTextNode: should skip no-op replacements after normalization", () => {
  assert.equal(
    contentScript.shouldReplaceWebTextNode(
      {
        mixedText: "保持原样",
        tokens: [{ type: "text", text: "保持原样" }]
      },
      "  保持原样  "
    ),
    false
  );
});

test("shouldReplaceWebTextNode: should keep real replacements", () => {
  assert.equal(
    contentScript.shouldReplaceWebTextNode(
      {
        mixedText: "我想system学习",
        tokens: [
          { type: "text", text: "我想" },
          { type: "word", word: "system" },
          { type: "text", text: "学习" }
        ]
      },
      "我想系统学习"
    ),
    true
  );
});

test("renderWebTextReplacementHtml: should pass runtime settings to renderer", () => {
  let capturedArgs = null;
  global.SubtitleRenderer = {
    renderToHtml(...args) {
      capturedArgs = args;
      return "<span>ok</span>";
    }
  };

  const result = { mixedText: "我想system学习" };
  const settings = { bilingualMode: "bilingual" };
  const html = contentScript.renderWebTextReplacementHtml(result, "我想系统学习", settings);

  assert.equal(html, "<span>ok</span>");
  assert.deepEqual(capturedArgs, [result, "我想系统学习", settings]);
});

test("buildRuntimeSettings: should merge updates on top of runtime baseline", () => {
  const next = contentScript.buildRuntimeSettings(
    {
      enabled: true,
      webPageEnabled: true,
      reviewDanmakuEnabled: false,
      reviewDanmakuSpeed: "normal",
      activeLevels: ["CET4"],
      replaceRatio: 0.2,
      maxReplaceCount: 2,
      targetCefr: "B2",
      vocabularyMode: "core",
      examPreference: "balanced",
      domainRules: {
        "example.com": { enabled: false }
      },
      schemaVersion: 999
    },
    {
      replaceRatio: 0.3,
      activeLevels: ["ielts", "IELTS"],
      schemaVersion: 1234
    }
  );

  assert.equal(next.replaceRatio, 0.3);
  assert.deepEqual(next.activeLevels, ["IELTS"]);
  assert.deepEqual(next.domainRules, {
    "example.com": { enabled: false }
  });
  assert.equal(next.schemaVersion, 2);
});

test("shouldRestoreWebItems: should return true when web page mode is disabled", () => {
  assert.equal(
    contentScript.shouldRestoreWebItems({
      enabled: true,
      webPageEnabled: false
    }),
    true
  );

  assert.equal(
    contentScript.shouldRestoreWebItems({
      enabled: true,
      webPageEnabled: true
    }),
    false
  );
});

test("shouldRunLegacyWebTextPipeline: should stay off by default and allow explicit debug override", () => {
  delete global.__BILI_VOCAB_ENABLE_LEGACY_WEB_TEXT_PIPELINE__;
  assert.equal(contentScript.shouldRunLegacyWebTextPipeline(), false);

  global.__BILI_VOCAB_ENABLE_LEGACY_WEB_TEXT_PIPELINE__ = true;
  assert.equal(contentScript.shouldRunLegacyWebTextPipeline(), true);

  delete global.__BILI_VOCAB_ENABLE_LEGACY_WEB_TEXT_PIPELINE__;
});

test("isVideoSiteHost: should recognize supported video hosts", () => {
  assert.equal(contentScript.isVideoSiteHost("www.youtube.com"), true);
  assert.equal(contentScript.isVideoSiteHost("www.bilibili.com"), true);
  assert.equal(contentScript.isVideoSiteHost("docs.example.com"), false);
  assert.equal(contentScript.isVideoSiteHost("notyoutube.com"), false);
  assert.equal(contentScript.isVideoSiteHost("youtube.com.evil.org"), false);
});

test("shouldEnableTimelinePolling: should only enable polling when a video element exists", () => {
  const previousQuerySelector = global.document.querySelector;
  try {
    global.location = { hostname: "www.youtube.com" };
    global.document.querySelector = () => null;
    assert.equal(contentScript.shouldEnableTimelinePolling(), false);

    global.location = { hostname: "docs.example.com" };
    assert.equal(contentScript.shouldEnableTimelinePolling(), false);

    global.document.querySelector = (selector) => (selector === "video" ? {} : null);
    assert.equal(contentScript.shouldEnableTimelinePolling(), true);
  } finally {
    global.document.querySelector = previousQuerySelector;
  }
});

test("shouldObserveDomMutations: should skip body observer only on non-video pages with web mode disabled", () => {
  const previousQuerySelector = global.document.querySelector;
  try {
    global.document.querySelector = () => null;

    assert.equal(
      contentScript.shouldObserveDomMutations({ webPageEnabled: false }, "docs.example.com"),
      false
    );

    assert.equal(
      contentScript.shouldObserveDomMutations({ webPageEnabled: true }, "docs.example.com"),
      true
    );

    assert.equal(
      contentScript.shouldObserveDomMutations({ webPageEnabled: false }, "www.youtube.com"),
      true
    );
  } finally {
    global.document.querySelector = previousQuerySelector;
  }
});

test("shouldRetargetSubtitleObserver: should switch from body observer to subtitle container when available", () => {
  const subtitleContainer = {};
  assert.equal(
    contentScript.shouldRetargetSubtitleObserver(global.document.body, subtitleContainer),
    true
  );
});

test("shouldRetargetSubtitleObserver: should keep current observer target when container is missing or already targeted", () => {
  const subtitleContainer = {};

  assert.equal(
    contentScript.shouldRetargetSubtitleObserver(global.document.body, null),
    false
  );

  assert.equal(
    contentScript.shouldRetargetSubtitleObserver(subtitleContainer, subtitleContainer),
    false
  );
});

test("shouldRefreshSubtitleObserver: should refresh only when target actually changes", () => {
  const bodyTarget = global.document.body;
  const subtitleContainer = {};

  assert.equal(
    contentScript.shouldRefreshSubtitleObserver(bodyTarget, subtitleContainer),
    true
  );

  assert.equal(
    contentScript.shouldRefreshSubtitleObserver(subtitleContainer, subtitleContainer),
    false
  );

  assert.equal(
    contentScript.shouldRefreshSubtitleObserver(subtitleContainer, null),
    true
  );
});

test("runInAnimationFrame: should execute frame task", async () => {
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  let called = false;
  await contentScript.runInAnimationFrame(async () => {
    called = true;
  });

  assert.equal(called, true);
});

test("runInAnimationFrame: should resolve even when task throws", async () => {
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  const previousConsoleError = console.error;
  console.error = () => {};

  let completed = false;
  try {
    await contentScript.runInAnimationFrame(async () => {
      throw new Error("frame failure");
    });
  } finally {
    console.error = previousConsoleError;
  }

  completed = true;
  assert.equal(completed, true);
});


test.after(() => {
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.VocabularyModule = previousVocabularyModule;
  global.requestAnimationFrame = previousRequestAnimationFrame;
  global.location = previousLocation;
  global.HTMLVideoElement = previousHTMLVideoElement;
  global.SubtitleRenderer = previousSubtitleRenderer;
});
