const test = require("node:test");
const assert = require("node:assert/strict");

function loadOverlayPanelFresh() {
  const modulePath = require.resolve("../overlayPanel.js");
  delete require.cache[modulePath];
  return require(modulePath);
}

test("mountOverlayPanel: should reuse mounted instance before rebinding DOM listeners", () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  const originalMountCache = global.__BILI_VOCAB_OVERLAY_INSTANCE__;

  const mountedInstance = {
    panel: { isConnected: true },
    marker: "cached-instance"
  };
  global.__BILI_VOCAB_OVERLAY_INSTANCE__ = mountedInstance;
  global.window = {};
  global.document = {
    createElement() {
      throw new Error("createElement should not be called when overlay instance is cached");
    },
    getElementById() {
      throw new Error("getElementById should not be called when overlay instance is cached");
    },
    body: {
      appendChild() {
        throw new Error("appendChild should not be called when overlay instance is cached");
      }
    }
  };

  try {
    const overlayPanel = loadOverlayPanelFresh();
    const result = overlayPanel.mountOverlayPanel();

    assert.equal(result, mountedInstance);
  } finally {
    if (typeof originalMountCache === "undefined") {
      delete global.__BILI_VOCAB_OVERLAY_INSTANCE__;
    } else {
      global.__BILI_VOCAB_OVERLAY_INSTANCE__ = originalMountCache;
    }
    if (typeof originalDocument === "undefined") {
      delete global.document;
    } else {
      global.document = originalDocument;
    }
    if (typeof originalWindow === "undefined") {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});
