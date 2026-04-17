const test = require('node:test');
const assert = require('node:assert/strict');

const previousDocument = global.document;
const previousWindow = global.window;
const previousHTMLElement = global.HTMLElement;

class MockElement {
  constructor({
    tagName = 'P',
    textContent = '',
    dataset = {},
    visible = true,
    childElementCount = 0,
  } = {}) {
    this.tagName = tagName;
    this.textContent = textContent;
    this.dataset = dataset;
    this.childElementCount = childElementCount;
    this.nodeType = 1;
    this._visible = visible;
    this.classList = {
      contains() {
        return false;
      },
    };
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return this._visible
      ? { width: 200, height: 24, left: 0, top: 0 }
      : { width: 0, height: 0, left: 0, top: 0 };
  }

  contains() {
    return false;
  }
}

global.HTMLElement = MockElement;
global.window = {
  getComputedStyle() {
    return { display: 'block', visibility: 'visible', opacity: '1' };
  },
};

global.document = {
  querySelector() {
    return null;
  },
  querySelectorAll(selector) {
    if (selector === 'article p') {
      return [
        new MockElement({
          tagName: 'P',
          textContent: 'This article helps you retain useful vocabulary in context.',
        }),
        new MockElement({ tagName: 'P', textContent: 'https://example.com should be skipped' }),
      ];
    }
    return [];
  },
};

const subtitleParser = require('../subtitleParser.js');

test('detectGenericTextElements: should keep readable article paragraphs and skip url-like text', () => {
  const items = subtitleParser.getCurrentSubtitleItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].mode, 'page');
  assert.match(items[0].text, /retain useful vocabulary/);
});

test.after(() => {
  global.document = previousDocument;
  global.window = previousWindow;
  global.HTMLElement = previousHTMLElement;
});
