const test = require('node:test');
const assert = require('node:assert/strict');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousReactOverlayModule = global.ReactOverlayModule;
const previousOverlayPanelModule = global.OverlayPanelModule;

global.document = {
  readyState: 'loading',
  addEventListener() {},
  querySelector() {
    return null;
  },
  body: {},
};

global.chrome = {
  runtime: {
    getURL() {
      return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
    },
  },
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

const contentScriptPath = require.resolve('../contentScript.js');
delete require.cache[contentScriptPath];
const contentScript = require('../contentScript.js');

test.beforeEach(() => {
  contentScript.__resetOverlayModuleStateForTest();
  delete global.ReactOverlayModule;
  delete global.OverlayPanelModule;
});

test('loadOverlayModule: should reuse global overlay module without runtime import', async () => {
  let getUrlCalls = 0;
  global.chrome.runtime.getURL = () => {
    getUrlCalls += 1;
    return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
  };
  const sharedModule = {
    mountOverlayPanel() {},
  };
  global.ReactOverlayModule = sharedModule;

  const loaded = await contentScript.loadOverlayModule();

  assert.equal(loaded, sharedModule);
  assert.equal(getUrlCalls, 0);
});

test('loadOverlayModule: should return null when runtime API is unavailable', async () => {
  const currentChrome = global.chrome;
  delete global.chrome;

  const loaded = await contentScript.loadOverlayModule();

  assert.equal(loaded, null);
  global.chrome = currentChrome;
});

test('loadOverlayModule: should cache imported module after first load', async () => {
  let getUrlCalls = 0;
  global.chrome.runtime.getURL = () => {
    getUrlCalls += 1;
    return 'data:text/javascript,export%20function%20mountOverlayPanel(){}';
  };

  const firstLoaded = await contentScript.loadOverlayModule();
  const secondLoaded = await contentScript.loadOverlayModule();

  assert.equal(typeof firstLoaded.mountOverlayPanel, 'function');
  assert.equal(secondLoaded, firstLoaded);
  assert.equal(getUrlCalls, 1);
});

test('loadOverlayModule: should retry import when loaded module is invalid', async () => {
  let getUrlCalls = 0;
  global.chrome.runtime.getURL = () => {
    getUrlCalls += 1;
    return 'data:text/javascript,export%20const%20value=1;';
  };

  const firstLoaded = await contentScript.loadOverlayModule();
  const secondLoaded = await contentScript.loadOverlayModule();

  assert.equal(firstLoaded, null);
  assert.equal(secondLoaded, null);
  assert.equal(getUrlCalls, 2);
});

test.after(() => {
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.ReactOverlayModule = previousReactOverlayModule;
  global.OverlayPanelModule = previousOverlayPanelModule;
  delete require.cache[contentScriptPath];
});
