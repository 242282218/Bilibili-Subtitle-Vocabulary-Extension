const test = require('node:test');
const assert = require('node:assert/strict');

const renderer = require('../renderer.js');

function createMockElement({ classNames = [], hasNestedCaptionSegment = false } = {}) {
  return {
    classList: {
      contains(name) {
        return classNames.includes(name);
      },
    },
    querySelector(selector) {
      if (selector === '.ytp-caption-segment' && hasNestedCaptionSegment) {
        return {};
      }
      return null;
    },
  };
}

test('shouldSkipYouTubeElementRewrite: non-leaf youtube caption node should be skipped', () => {
  const element = createMockElement({ classNames: ['caption-visual-line'] });
  assert.equal(renderer.shouldSkipYouTubeElementRewrite(element, 'www.youtube.com'), true);
});

test('shouldSkipYouTubeElementRewrite: youtube caption leaf node should be renderable', () => {
  const element = createMockElement({ classNames: ['ytp-caption-segment'] });
  assert.equal(renderer.shouldSkipYouTubeElementRewrite(element, 'www.youtube.com'), false);
});

test('shouldSkipYouTubeElementRewrite: node with nested caption segments should be skipped', () => {
  const element = createMockElement({
    classNames: ['ytp-caption-segment'],
    hasNestedCaptionSegment: true,
  });

  assert.equal(renderer.shouldSkipYouTubeElementRewrite(element, 'www.youtube.com'), true);
});

test('shouldSkipYouTubeElementRewrite: non-youtube host should not be skipped', () => {
  const element = createMockElement({ classNames: ['caption-visual-line'] });
  assert.equal(renderer.shouldSkipYouTubeElementRewrite(element, 'www.bilibili.com'), false);
});

test('renderTokensToHtml: should render as word with original text in parentheses', () => {
  const html = renderer.renderTokensToHtml(
    [
      { type: 'text', text: 'we ' },
      {
        type: 'word',
        word: 'optimize',
        sourceText: 'improve',
        meaning: 'improve',
        level: 'IELTS',
        learningStatus: 'learning',
      },
      { type: 'text', text: ' system' },
    ],
    'we improve system'
  );

  assert.equal(html.includes('optimize（improve）'), true);
  assert.equal(html.includes('data-learning-status="learning"'), true);
  assert.equal(html.includes('data-original-subtitle="we improve system"'), true);
});

test('renderToHtml: should keep bilingual page mode distinct from english-only output', () => {
  const translationResult = {
    mixedText: '我想system学习',
    tokens: [
      { type: 'text', text: '我想' },
      {
        type: 'word',
        word: 'system',
        sourceText: '系统',
        meaning: '系统',
        level: 'CET4',
      },
      { type: 'text', text: '学习' },
    ],
  };

  const bilingualHtml = renderer.renderToHtml(translationResult, '我想系统学习', {
    bilingualMode: 'bilingual',
  });
  const englishOnlyHtml = renderer.renderToHtml(translationResult, '我想系统学习', {
    bilingualMode: 'english-only',
  });

  assert.notEqual(bilingualHtml, englishOnlyHtml);
  assert.match(bilingualHtml, /class="bili-vocab-bilingual-line"/);
  assert.match(bilingualHtml, /class="bili-vocab-bilingual-translation"/);
  assert.match(bilingualHtml, />我想系统学习</);
  assert.doesNotMatch(englishOnlyHtml, /bili-vocab-bilingual-translation/);
});
