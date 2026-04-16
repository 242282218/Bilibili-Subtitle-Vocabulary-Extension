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
  return {
    checked: false,
    value: "",
    textContent: "",
    innerHTML: "",
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
  let lastFileInput = null;

  const getNode = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, createElementStub());
    }
    return nodes.get(id);
  };

  const documentStub = {
    readyState: "loading",
    body: {
      classList: createClassList(),
      dataset: {},
      appendChild() {},
      removeChild() {}
    },
    addEventListener() {},
    getElementById(id) {
      return getNode(id);
    },
    querySelectorAll(selector) {
      if (selector === ".hero-metric__meta") {
        return [createElementStub(), createElementStub(), createElementStub()];
      }
      if (selector === ".hub-scenario-card") {
        return [];
      }
      if (selector === 'input[name="activeLevels"]') {
        return activeLevelNodes;
      }
      if (selector === ".hub-reveal-target") {
        return [];
      }
      return [];
    },
    createElement(tagName) {
      if (tagName === "input") {
        lastFileInput = {
          type: "",
          accept: "",
          onchange: null,
          click() {}
        };
        return lastFileInput;
      }

      return createElementStub();
    },
    __getLastFileInput() {
      return lastFileInput;
    },
    __getNode(id) {
      return getNode(id);
    }
  };

  return documentStub;
}

function createChromeStorageStub(storageState) {
  return {
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
          Object.assign(storageState, payload);
          if (typeof callback === "function") {
            callback();
          }
        }
      }
    },
    runtime: {
      lastError: null
    }
  };
}

test("options import/reset behavior: should persist imported settings and restore defaults", async () => {
  const previousDocument = global.document;
  const previousChrome = global.chrome;
  const previousConfirm = global.confirm;
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;

  const documentStub = createDocumentStub();
  const storageState = {};
  const optionsPath = path.join(__dirname, "..", "options.js");

  try {
    global.document = documentStub;
    global.chrome = createChromeStorageStub(storageState);
    global.confirm = () => true;
    global.setTimeout = (fn) => {
      if (typeof fn === "function") {
        fn();
      }
      return 1;
    };
    global.clearTimeout = () => {};

    delete require.cache[require.resolve(optionsPath)];
    const options = require(optionsPath);

    options.importSettings();
    const fileInput = documentStub.__getLastFileInput();
    assert.ok(fileInput, "import should create file input");
    assert.equal(typeof fileInput.onchange, "function");

    await fileInput.onchange({
      target: {
        files: [{
          text: async () => JSON.stringify({
            enabled: true,
            replaceRatio: 0.3,
            maxReplaceCount: 4,
            targetCefr: "C1",
            reviewDanmakuSpeed: "fast",
            activeLevels: ["IELTS"]
          })
        }]
      }
    });

    assert.equal(storageState.replaceRatio, 0.3);
    assert.equal(storageState.maxReplaceCount, 4);
    assert.equal(storageState.targetCefr, "C1");
    assert.equal(storageState.reviewDanmakuSpeed, "fast");
    assert.deepEqual(storageState.activeLevels, ["IELTS"]);
    assert.equal(documentStub.__getNode("replaceRatio").value, "0.30");
    assert.equal(documentStub.__getNode("targetCefr").value, "C1");
    assert.equal(documentStub.__getNode("reviewDanmakuSpeed").value, "fast");

    await options.resetSettings();

    assert.equal(storageState.replaceRatio, 0.2);
    assert.equal(storageState.maxReplaceCount, 2);
    assert.equal(storageState.targetCefr, "B2");
    assert.equal(storageState.reviewDanmakuSpeed, "normal");
    assert.deepEqual(storageState.activeLevels, ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"]);
    assert.equal(documentStub.__getNode("replaceRatio").value, "0.20");
    assert.equal(documentStub.__getNode("targetCefr").value, "B2");
    assert.equal(documentStub.__getNode("reviewDanmakuSpeed").value, "normal");
  } finally {
    delete require.cache[require.resolve(optionsPath)];
    global.document = previousDocument;
    global.chrome = previousChrome;
    global.confirm = previousConfirm;
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});
