const test = require('node:test');
const assert = require('node:assert/strict');

const popup = require('../popup.js');

test('getHeroMetricMeta: should describe low ratio as gentle reading pace', () => {
  assert.equal(popup.getHeroMetricMeta('ratio', 0.1), '轻量低扰');
});

test('getHeroMetricMeta: should describe medium ratio as balanced exposure', () => {
  assert.equal(popup.getHeroMetricMeta('ratio', 0.2), '均衡曝光');
});

test('getHeroMetricMeta: should describe high ratio as intensive mode', () => {
  assert.equal(popup.getHeroMetricMeta('ratio', 0.3), '强化输入');
});

test('getHeroMetricMeta: should describe review speed presets', () => {
  assert.equal(popup.getHeroMetricMeta('reviewSpeed', 'slow'), '低压慢复习');
  assert.equal(popup.getHeroMetricMeta('reviewSpeed', 'normal'), '稳定推进');
  assert.equal(popup.getHeroMetricMeta('reviewSpeed', 'fast'), '冲刺高频');
});
