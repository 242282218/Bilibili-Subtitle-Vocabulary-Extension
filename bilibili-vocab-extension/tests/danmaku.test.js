const test = require("node:test");
const assert = require("node:assert/strict");

class MockElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.style = {};
    this.parentElement = null;
    this.className = "";
    this.id = "";
    this.textContent = "";
    this._innerHTML = "";
    this.listeners = new Map();
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }
    return child;
  }

  querySelector(selector) {
    if (!selector || selector[0] !== "#") {
      return null;
    }

    const id = selector.slice(1);
    return this.findById(id);
  }

  findById(id) {
    if (this.id === id) {
      return this;
    }

    for (const child of this.children) {
      if (typeof child.findById === "function") {
        const match = child.findById(id);
        if (match) {
          return match;
        }
      }
    }

    return null;
  }

  addEventListener(type, handler, options = {}) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }

    this.listeners.get(type).push({ handler, once: Boolean(options.once) });
  }

  dispatchEvent(type) {
    const listeners = this.listeners.get(type) || [];
    const retained = [];

    listeners.forEach((listener) => {
      listener.handler();
      if (!listener.once) {
        retained.push(listener);
      }
    });

    this.listeners.set(type, retained);
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    if (this._innerHTML === "") {
      this.children.forEach((child) => {
        child.parentElement = null;
      });
      this.children = [];
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

global.HTMLElement = MockElement;
global.HTMLVideoElement = class MockVideoElement extends MockElement {};

const host = new MockElement("div");

global.document = {
  documentElement: new MockElement("html"),
  createElement(tagName) {
    return new MockElement(tagName);
  },
  querySelector(selector) {
    if (selector === ".bpx-player-video-wrap") {
      return host;
    }

    return null;
  }
};

global.MutationObserver = class MockMutationObserver {
  observe() {}

  disconnect() {}
};

global.requestAnimationFrame = (callback) => {
  callback();
  return 1;
};

global.getComputedStyle = () => ({ position: "relative" });

const danmaku = require("../scripts/danmaku.js");

test("shootWordDanmaku: should drop the frame when all tracks are cooling down", () => {
  const originalNow = Date.now;
  Date.now = () => 1000;
  danmaku.clearDanmaku();

  try {
    for (let index = 0; index < 10; index += 1) {
      const result = danmaku.shootWordDanmaku({
        word: `word-${index}`,
        translation: "测试"
      });

      assert.equal(result, true);
    }

    const overflow = danmaku.shootWordDanmaku({
      word: "overflow",
      translation: "测试"
    });

    assert.equal(overflow, false);
  } finally {
    Date.now = originalNow;
    danmaku.clearDanmaku();
  }
});

test("shootWordDanmaku: should reuse a track only after the previous danmaku leaves the screen", () => {
  const originalNow = Date.now;
  Date.now = () => 1000;
  danmaku.clearDanmaku();

  try {
    for (let index = 0; index < 10; index += 1) {
      assert.equal(
        danmaku.shootWordDanmaku({
          word: `word-${index}`,
          translation: "test"
        }),
        true
      );
    }

    const container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    assert.ok(container);
    const firstNode = container.children[0];
    assert.ok(firstNode);

    assert.equal(
      danmaku.shootWordDanmaku({
        word: "blocked",
        translation: "test"
      }),
      false
    );

    firstNode.dispatchEvent("transitionend");

    assert.equal(
      danmaku.shootWordDanmaku({
        word: "reused",
        translation: "test"
      }),
      true
    );
  } finally {
    Date.now = originalNow;
    danmaku.clearDanmaku();
  }
});

test("setSpeedPreset: should apply preset duration to newly fired danmaku", () => {
  danmaku.clearDanmaku();

  try {
    danmaku.setSpeedPreset("fast");
    assert.equal(
      danmaku.shootWordDanmaku({
        word: "fast-word",
        translation: "test"
      }),
      true
    );

    let container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    assert.ok(container);
    let node = container.children[container.children.length - 1];
    assert.equal(node.style.transition, `transform ${danmaku.getFlyDurationMs()}ms linear`);

    danmaku.clearDanmaku();
    danmaku.setSpeedPreset("slow");
    assert.equal(
      danmaku.shootWordDanmaku({
        word: "slow-word",
        translation: "test"
      }),
      true
    );

    container = host.findById(danmaku.DANMAKU_CONTAINER_ID);
    node = container.children[container.children.length - 1];
    assert.equal(node.style.transition, `transform ${danmaku.getFlyDurationMs()}ms linear`);
  } finally {
    danmaku.setSpeedPreset("normal");
    danmaku.clearDanmaku();
  }
});
