const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

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
