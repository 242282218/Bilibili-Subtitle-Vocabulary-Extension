const test = require('node:test');
const assert = require('node:assert/strict');

const subtitleParser = require('../subtitleParser.js');
const renderer = require('../renderer.js');

class MockTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
  }
}

class MockElement {
  constructor({ textContent = '', dataset = {}, classNames = [], childNodes = [] } = {}) {
    this.nodeType = 1;
    this.textContent = textContent;
    this.dataset = dataset;
    this.childNodes = childNodes;
    this.childElementCount = childNodes.filter((node) => node && node.nodeType === 1).length;
    this.classList = {
      contains: (name) => classNames.includes(name),
    };
  }
}

test('extractSubtitleText: should prefer full original subtitle from rendered word nodes', () => {
  const previousHTMLElement = global.HTMLElement;
  global.HTMLElement = MockElement;

  try {
    const element = new MockElement({
      textContent: 'left former(model) right',
      childNodes: [
        new MockTextNode('left '),
        new MockElement({
          textContent: 'former(model)',
          dataset: {
            sourceText: 'model',
            originalSubtitle: 'leftmodelright',
          },
          classNames: ['bili-vocab-word'],
        }),
        new MockTextNode(' right'),
      ],
    });

    const extracted = subtitleParser.extractSubtitleText(element);
    assert.equal(extracted, 'leftmodelright');
  } finally {
    global.HTMLElement = previousHTMLElement;
  }
});

test('renderTokensToHtml: should preserve full original subtitle on rendered word nodes', () => {
  const html = renderer.renderTokensToHtml(
    [
      {
        type: 'word',
        word: 'former',
        sourceText: 'model',
        meaning: 'model',
        level: 'IELTS',
      },
    ],
    'leftmodelright'
  );

  assert.equal(html.includes('data-original-subtitle="leftmodelright"'), true);
});
