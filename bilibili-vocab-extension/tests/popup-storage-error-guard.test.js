const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const learningState = require("../learningState.js");

const LEARNING_WORD_STATS_STORAGE_KEY = learningState.STORAGE_KEYS.WORD_STATS_V2;
const REVIEW_QUEUE_STORAGE_KEY = learningState.STORAGE_KEYS.REVIEW_QUEUE;
const LEARNING_SUMMARY_STORAGE_KEY = learningState.STORAGE_KEYS.LEARNING_SUMMARY;

function createClassList() {
  return {
    add() {},
    remove() {},
    toggle() {}
  };
}

function createElementStub() {
  const listeners = new Map();
  return {
    checked: false,
    value: "",
    textContent: "",
    innerHTML: "",
    dataset: {},
    style: {},
    disabled: false,
    classList: createClassList(),
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    },
    setAttribute() {},
    appendChild() {},
    removeChild() {},
    querySelector() {
      return null;
    },
    __trigger(type, payload = {}) {
      const list = listeners.get(type) || [];
      list.forEach((listener) => listener(payload));
    }
  };
}

function createDocumentStub() {
  const nodes = new Map();
  const activeLevelNodes = ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"].map((value) => ({
    value,
    checked: value === "CET4" || value === "CET6",
    addEventListener() {}
  }));

  const getNode = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, createElementStub());
    }
    return nodes.get(id);
  };

  return {
    readyState: "complete",
    body: {
      classList: createClassList(),
      dataset: {},
      appendChild() {},
      removeChild() {}
    },
    addEventListener() {},
    createElement() {
      return createElementStub();
    },
    getElementById(id) {
      return getNode(id);
    },
    querySelectorAll(selector) {
      if (selector === ".hero-metric__meta") {
        return [createElementStub(), createElementStub(), createElementStub()];
      }
      if (selector === ".popup-ranking-tab") {
        return [];
      }
      if (selector === 'input[name="activeLevels"]') {
        return activeLevelNodes;
      }
      return [];
    },
    __getNode(id) {
      return getNode(id);
    }
  };
}

function createChromeStub(storageState, shouldFailSet) {
  const runtime = {
    lastError: null
  };

  return {
    runtime,
    tabs: {
      query(_query, callback) {
        callback([{ url: "https://www.bilibili.com/video/BV1xx411c7mD" }]);
      }
    },
    storage: {
      onChanged: {
        addListener() {},
        removeListener() {}
      },
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

          if (keysOrDefaults && typeof keysOrDefaults === "object") {
            callback({
              ...keysOrDefaults,
              ...storageState
            });
            return;
          }

          callback({ ...storageState });
        },
        set(payload, callback) {
          const failed = typeof shouldFailSet === "function" ? shouldFailSet(payload) : false;
          if (!failed) {
            Object.assign(storageState, payload);
          }
          runtime.lastError = failed ? { message: "mock write failed" } : null;
          if (typeof callback === "function") {
            callback();
          }
          runtime.lastError = null;
        }
      }
    }
  };
}

function withPopupRuntime({ storageState, shouldFailSet }, run) {
  const previousDocument = global.document;
  const previousChrome = global.chrome;
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  const popupPath = path.join(__dirname, "..", "popup.js");

  try {
    global.document = createDocumentStub();
    global.chrome = createChromeStub(storageState, shouldFailSet);
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};

    delete require.cache[require.resolve(popupPath)];
    require(popupPath);
    run(global.document);
  } finally {
    delete require.cache[require.resolve(popupPath)];
    global.document = previousDocument;
    global.chrome = previousChrome;
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
}

function createQuickReviewStorageState() {
  const now = 1700000000000;
  const stats = {
    system: learningState.normalizeLearningRecord({
      word: "system",
      translation: "系统",
      level: "CET4",
      status: "learning",
      reviewCount: 1,
      masteryScore: 10,
      intervalDays: 1,
      easeFactor: 2.3,
      nextReviewAt: now - 2000,
      updatedAt: now - 3000
    }),
    context: learningState.normalizeLearningRecord({
      word: "context",
      translation: "语境",
      level: "CET6",
      status: "learning",
      reviewCount: 2,
      masteryScore: 20,
      intervalDays: 1,
      easeFactor: 2.3,
      nextReviewAt: now + 1000,
      updatedAt: now - 1000
    })
  };
  const queue = learningState.normalizeReviewQueue({
    system: {
      word: "system",
      dueBucket: "today",
      intervalDays: 1,
      easeFactor: 2.3,
      nextReviewAt: now - 2000,
      updatedAt: now - 3000
    },
    context: {
      word: "context",
      dueBucket: "today",
      intervalDays: 1,
      easeFactor: 2.3,
      nextReviewAt: now + 1000,
      updatedAt: now - 1000
    }
  });

  return {
    [LEARNING_WORD_STATS_STORAGE_KEY]: stats,
    [REVIEW_QUEUE_STORAGE_KEY]: queue,
    [LEARNING_SUMMARY_STORAGE_KEY]: learningState.buildLearningSummary(stats, queue)
  };
}

test("popup review danmaku toggle: should keep previous state when storage write fails", () => {
  const storageState = {
    reviewDanmakuEnabled: false
  };

  withPopupRuntime(
    {
      storageState,
      shouldFailSet(payload) {
        return Object.prototype.hasOwnProperty.call(payload, "reviewDanmakuEnabled");
      }
    },
    (documentStub) => {
      const reviewButton = documentStub.__getNode("reviewDanmakuButton");
      const statusNode = documentStub.__getNode("status");

      assert.equal(reviewButton.textContent, "启动复习弹幕");
      reviewButton.__trigger("click");

      assert.equal(storageState.reviewDanmakuEnabled, false);
      assert.equal(reviewButton.textContent, "启动复习弹幕");
      assert.equal(statusNode.textContent, "复习弹幕切换失败，请重试");
    }
  );
});

test("popup site toggle: should keep previous state when storage write fails", () => {
  const storageState = {
    domainRules: {}
  };

  withPopupRuntime(
    {
      storageState,
      shouldFailSet(payload) {
        return Object.prototype.hasOwnProperty.call(payload, "domainRules");
      }
    },
    (documentStub) => {
      const siteToggleButton = documentStub.__getNode("siteToggleButton");
      const statusNode = documentStub.__getNode("status");

      assert.equal(siteToggleButton.textContent, "暂停当前站点");
      siteToggleButton.__trigger("click");

      assert.deepEqual(storageState.domainRules, {});
      assert.equal(siteToggleButton.textContent, "暂停当前站点");
      assert.equal(statusNode.textContent, "当前站点切换失败，请重试");
    }
  );
});

test("popup quick review: should keep dashboard and card state when storage write fails", () => {
  const storageState = createQuickReviewStorageState();

  withPopupRuntime(
    {
      storageState,
      shouldFailSet(payload) {
        return Object.prototype.hasOwnProperty.call(payload, LEARNING_WORD_STATS_STORAGE_KEY);
      }
    },
    (documentStub) => {
      const quickReviewButton = documentStub.__getNode("quickReviewButton");
      const quickReviewWord = documentStub.__getNode("quickReviewWord");
      const reviewActionKnow = documentStub.__getNode("reviewActionKnow");
      const reviewCountToday = documentStub.__getNode("reviewCountToday");
      const statusNode = documentStub.__getNode("status");
      const toastNode = documentStub.__getNode("toast");

      assert.equal(quickReviewWord.textContent, "system · 系统");
      assert.equal(reviewCountToday.textContent, "今日待复习 2");

      reviewActionKnow.__trigger("click");

      assert.equal(storageState[LEARNING_WORD_STATS_STORAGE_KEY].system.reviewCount, 1);
      assert.equal(quickReviewWord.textContent, "system · 系统");
      assert.equal(reviewCountToday.textContent, "今日待复习 2");
      assert.equal(statusNode.textContent, "快速复习保存失败，请重试");
      assert.equal(toastNode.textContent, "复习结果未保存");

      quickReviewButton.__trigger("click");
      assert.equal(quickReviewWord.textContent, "system · 系统");
      assert.equal(reviewCountToday.textContent, "今日待复习 2");
    }
  );
});
