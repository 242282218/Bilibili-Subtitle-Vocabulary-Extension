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

test('extractSubtitleText: should prefer stored original subtitle text on rendered nodes', () => {
  const previousHTMLElement = global.HTMLElement;
  global.HTMLElement = MockElement;

  try {
    const element = new MockElement({
      textContent: 'pyramid（金字塔）',
      dataset: {
        biliVocabOriginalText: '金字塔',
      },
    });

    const extracted = subtitleParser.extractSubtitleText(element);
    assert.equal(extracted, '金字塔');
  } finally {
    global.HTMLElement = previousHTMLElement;
  }
});

test('extractSubtitleText: should recover source text from rendered word nodes when parent dataset is missing', () => {
  const previousHTMLElement = global.HTMLElement;
  global.HTMLElement = MockElement;

  try {
    const element = new MockElement({
      textContent: 'we pyramid（金字塔） now',
      childNodes: [
        new MockTextNode('we '),
        new MockElement({
          textContent: 'pyramid（金字塔）',
          dataset: {
            sourceText: '金字塔',
          },
          classNames: ['bsv-word'],
        }),
        new MockTextNode(' now'),
      ],
    });

    const extracted = subtitleParser.extractSubtitleText(element);
    assert.equal(extracted, 'we 金字塔 now');
  } finally {
    global.HTMLElement = previousHTMLElement;
  }
});

test('renderTokensToHtml: should preserve original source text on rendered word nodes', () => {
  const html = renderer.renderTokensToHtml([
    {
      type: 'word',
      word: 'pyramid',
      sourceText: '金字塔',
      meaning: '金字塔',
      level: 'IELTS',
    },
  ]);

  assert.equal(html.includes('data-source-text="金字塔"'), true);
});
