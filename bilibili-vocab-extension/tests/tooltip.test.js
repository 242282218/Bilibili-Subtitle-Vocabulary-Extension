const test = require('node:test');
const assert = require('node:assert/strict');

const tooltip = require('../tooltip.js');

test('renderTooltipContent: should include context, learning status and quick actions', () => {
  const html = tooltip.renderTooltipContent({
    dataset: {
      word: 'retain',
      meaning: '记住',
      level: 'CET6',
      cefrLevel: 'B2',
      frequency: '12345',
      phonetic: '/rɪˈteɪn/',
      pos: 'v.',
      definition: 'keep in memory',
      originalSubtitle: '这能帮助你更好地记住知识。',
      learningStatus: 'seen',
    },
    textContent: 'retain',
  });

  assert.match(html, /这能帮助你更好地记住知识/);
  assert.match(html, /当前状态/);
  assert.match(html, /已遇见/);
  assert.match(html, /data-feedback="know"/);
  assert.match(html, /data-feedback="fuzzy"/);
  assert.match(html, /data-feedback="dontKnow"/);
  assert.match(html, /data-feedback="save"/);
  assert.match(html, /data-feedback="skip"/);
  assert.match(html, /data-feedback="misreplace"/);
});

test('buildWordSourceMetadata: should capture current page source and video time', (t) => {
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;

  globalThis.document = {
    title: '  Demo Subtitle Video  ',
    querySelector(selector) {
      assert.equal(selector, 'video');
      return {
        currentTime: 3723.9,
      };
    },
  };
  globalThis.location = {
    href: 'https://www.bilibili.com/video/BV1demo',
  };

  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.location = previousLocation;
  });

  assert.deepEqual(tooltip.buildWordSourceMetadata(), {
    title: 'Demo Subtitle Video',
    url: 'https://www.bilibili.com/video/BV1demo',
    timeSeconds: 3723,
    timeLabel: '1:02:03',
  });
});

test('reportContextMisreplaceFeedback: should forward word feedback to translator module', () => {
  const calls = [];
  globalThis.SubtitleTranslator = {
    reportContextMisreplace(word, options) {
      calls.push({ word, options });
      return { word, inCooldown: true };
    },
  };

  const result = tooltip.reportContextMisreplaceFeedback('optimize', {
    severity: 'high',
    now: 1700000000000,
  });
  assert.deepEqual(calls, [
    {
      word: 'optimize',
      options: { severity: 'high', now: 1700000000000 },
    },
  ]);
  assert.deepEqual(result, { word: 'optimize', inCooldown: true });

  delete globalThis.SubtitleTranslator;
});
