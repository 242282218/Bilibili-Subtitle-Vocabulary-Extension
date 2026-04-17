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
