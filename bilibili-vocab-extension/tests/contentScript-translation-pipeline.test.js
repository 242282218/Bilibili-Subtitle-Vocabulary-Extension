const test = require('node:test');
const assert = require('node:assert/strict');

const previousDocument = global.document;
const previousChrome = global.chrome;
const previousLocation = global.location;
const previousRequestAnimationFrame = global.requestAnimationFrame;
const previousHTMLVideoElement = global.HTMLVideoElement;
const previousHTMLElement = global.HTMLElement;
const previousSubtitleParser = global.SubtitleParser;
const previousSubtitleRenderer = global.SubtitleRenderer;
const previousSubtitleTranslator = global.SubtitleTranslator;
const previousVocabularyModule = global.VocabularyModule;
const previousTooltipModule = global.TooltipModule;
const previousSchedulerModule = global.SchedulerModule;
const previousDanmakuModule = global.DanmakuModule;
const previousMutationObserver = global.MutationObserver;

const contentScriptPath = require.resolve('../contentScript/index.js');

class HarnessElement {
  constructor(text = '') {
    this.dataset = { originalText: text };
    this.textContent = text;
    this.classList = {
      add() {},
      remove() {},
    };
  }
}

function installBaseGlobals() {
  global.HTMLElement = HarnessElement;
  global.HTMLVideoElement = class FakeVideoElement {};
  global.document = {
    readyState: 'loading',
    body: new HarnessElement('body'),
    addEventListener() {},
    querySelector() {
      return null;
    },
  };
  global.chrome = {
    storage: {
      local: {
        get(_defaults, callback) {
          callback({});
        },
        set() {},
      },
      onChanged: {
        addListener() {},
      },
    },
  };
  global.location = { hostname: 'www.bilibili.com' };
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  global.MutationObserver = class MutationObserver {
    disconnect() {}

    observe() {}
  };
  global.TooltipModule = { init() {} };
  global.SchedulerModule = {
    startEngine() {},
    stopEngine() {},
    pauseEngine() {},
  };
  global.DanmakuModule = {
    clearDanmaku() {},
    setSpeedPreset() {},
    initDanmakuContainer() {},
  };
  global.VocabularyModule = {
    async loadVocabulary() {},
    recordHit() {},
    refreshLearningStateFromStorage() {
      return Promise.resolve();
    },
  };
}

function loadContentScript() {
  delete require.cache[contentScriptPath];
  installBaseGlobals();
  return require('../contentScript/index.js');
}

test('translation pipeline: subtitle text hit should render replacement result', async () => {
  const element = new HarnessElement('我想系统学习');
  const calls = [];
  const contentScript = loadContentScript();

  global.SubtitleParser = {
    extractSubtitleText() {
      return '我想系统学习';
    },
  };
  global.SubtitleTranslator = {
    async processSubtitle(text) {
      calls.push(text);
      return {
        mixedText: '我想system学习',
        tokens: [{ type: 'word', word: 'system', sourceText: '系统' }],
      };
    },
    createSettingsFingerprint() {
      return 'settings-v1';
    },
  };
  global.SubtitleRenderer = {
    renderSubtitleElement(target, result, sourceText) {
      target.dataset.renderedMixedText = result.mixedText;
      target.dataset.renderedSourceText = sourceText;
      return true;
    },
    restoreSubtitleElement() {},
  };

  await contentScript.applyTranslation(element);

  assert.deepEqual(calls, ['我想系统学习']);
  assert.equal(element.dataset.renderedMixedText, '我想system学习');
  assert.equal(element.dataset.renderedSourceText, '我想系统学习');
});

test('translation pipeline: no-hit subtitle should keep original rendered text', async () => {
  const element = new HarnessElement('保持原样');
  const contentScript = loadContentScript();

  global.SubtitleParser = {
    extractSubtitleText() {
      return '保持原样';
    },
  };
  global.SubtitleTranslator = {
    async processSubtitle(text) {
      return {
        mixedText: text,
        tokens: [{ type: 'text', text }],
      };
    },
    createSettingsFingerprint() {
      return 'settings-v1';
    },
  };
  global.SubtitleRenderer = {
    renderSubtitleElement(target, result, sourceText) {
      target.textContent = result.mixedText || sourceText;
      return true;
    },
    restoreSubtitleElement() {},
  };

  await contentScript.applyTranslation(element);

  assert.equal(element.textContent, '保持原样');
});

test('translation pipeline: cache hit should not recompute the same subtitle', async () => {
  const element = new HarnessElement('系统学习');
  const contentScript = loadContentScript();
  let translateCalls = 0;

  global.SubtitleParser = {
    extractSubtitleText() {
      return '系统学习';
    },
  };
  global.SubtitleTranslator = {
    async processSubtitle() {
      translateCalls += 1;
      return {
        mixedText: 'system学习',
        tokens: [{ type: 'word', word: 'system' }],
      };
    },
    createSettingsFingerprint() {
      return 'settings-v1';
    },
  };
  global.SubtitleRenderer = {
    renderSubtitleElement() {
      return true;
    },
    restoreSubtitleElement() {},
  };

  await contentScript.applyTranslation(element);
  delete element.dataset.biliVocabRenderSignature;
  await contentScript.applyTranslation(element);

  assert.equal(translateCalls, 1);
});

test('translation pipeline: selection state version should invalidate cached translation result', async () => {
  const element = new HarnessElement('系统学习');
  const contentScript = loadContentScript();
  let translateCalls = 0;
  let selectionStateVersion = 0;

  global.SubtitleParser = {
    extractSubtitleText() {
      return '系统学习';
    },
  };
  global.SubtitleTranslator = {
    async processSubtitle() {
      translateCalls += 1;
      return {
        mixedText: `system学习-${translateCalls}`,
        tokens: [{ type: 'word', word: 'system' }],
      };
    },
    createSettingsFingerprint() {
      return 'settings-v1';
    },
    getSelectionStateVersion() {
      return selectionStateVersion;
    },
  };
  global.SubtitleRenderer = {
    renderSubtitleElement(target, result) {
      target.dataset.renderedMixedText = result.mixedText;
      return true;
    },
    restoreSubtitleElement() {},
  };

  await contentScript.applyTranslation(element);
  delete element.dataset.biliVocabRenderSignature;
  await contentScript.applyTranslation(element);
  selectionStateVersion = 1;
  delete element.dataset.biliVocabRenderSignature;
  await contentScript.applyTranslation(element);

  assert.equal(translateCalls, 2);
  assert.equal(element.dataset.renderedMixedText, 'system学习-2');
});

test('translation pipeline: context feedback version should update render signature', () => {
  const contentScript = loadContentScript();
  let contextFeedbackVersion = 0;

  global.SubtitleTranslator = {
    createSettingsFingerprint() {
      return 'settings-v1';
    },
    getContextFeedbackVersion() {
      return contextFeedbackVersion;
    },
  };

  const before = contentScript.createRenderSignature('系统学习', {});
  contextFeedbackVersion = 1;
  const after = contentScript.createRenderSignature('系统学习', {});

  assert.notEqual(after, before);
  assert.match(after, /context:1/);
});

test('translation pipeline: settings change should invalidate cache and reprocess', async () => {
  const element = new HarnessElement('系统学习');
  const contentScript = loadContentScript();
  const fingerprints = ['settings-v1', 'settings-v2'];
  let translateCalls = 0;

  global.SubtitleParser = {
    extractSubtitleText() {
      return '系统学习';
    },
  };
  global.SubtitleTranslator = {
    async processSubtitle() {
      translateCalls += 1;
      return {
        mixedText: `system学习-${translateCalls}`,
        tokens: [{ type: 'word', word: 'system' }],
      };
    },
    createSettingsFingerprint() {
      return fingerprints[Math.min(translateCalls, fingerprints.length - 1)];
    },
  };
  global.SubtitleRenderer = {
    renderSubtitleElement() {
      return true;
    },
    restoreSubtitleElement() {},
  };

  await contentScript.applyTranslation(element);
  delete element.dataset.biliVocabRenderSignature;
  await contentScript.applyTranslation(element);

  assert.equal(translateCalls, 2);
});

test('translation pipeline: renderer failure should keep subtitle source text intact', async () => {
  const element = new HarnessElement('系统学习');
  const contentScript = loadContentScript();

  global.SubtitleParser = {
    extractSubtitleText() {
      return '系统学习';
    },
  };
  global.SubtitleTranslator = {
    async processSubtitle() {
      return {
        mixedText: 'system学习',
        tokens: [{ type: 'word', word: 'system' }],
      };
    },
    createSettingsFingerprint() {
      return 'settings-v1';
    },
  };
  global.SubtitleRenderer = {
    renderSubtitleElement() {
      return false;
    },
    restoreSubtitleElement() {},
  };

  await contentScript.applyTranslation(element);

  assert.equal(element.textContent, '系统学习');
  assert.equal(element.dataset.biliVocabRenderSignature, undefined);
});

test.after(() => {
  delete require.cache[contentScriptPath];
  global.document = previousDocument;
  global.chrome = previousChrome;
  global.location = previousLocation;
  global.requestAnimationFrame = previousRequestAnimationFrame;
  global.HTMLVideoElement = previousHTMLVideoElement;
  global.HTMLElement = previousHTMLElement;
  global.SubtitleParser = previousSubtitleParser;
  global.SubtitleRenderer = previousSubtitleRenderer;
  global.SubtitleTranslator = previousSubtitleTranslator;
  global.VocabularyModule = previousVocabularyModule;
  global.TooltipModule = previousTooltipModule;
  global.SchedulerModule = previousSchedulerModule;
  global.DanmakuModule = previousDanmakuModule;
  global.MutationObserver = previousMutationObserver;
});
