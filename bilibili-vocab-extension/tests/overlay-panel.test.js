const test = require('node:test');
const assert = require('node:assert/strict');

const overlayPanel = require('../overlayPanel.js');

test('normalizeOverlaySettings: should sanitize width, height and flags', () => {
  const normalized = overlayPanel.normalizeOverlaySettings({
    overlayPanelHidden: true,
    overlayPanelCollapsed: false,
    overlayPanelWidth: 999,
    overlayPanelHeight: 120,
  });

  assert.equal(normalized.overlayPanelHidden, true);
  assert.equal(normalized.overlayPanelCollapsed, false);
  assert.equal(normalized.overlayPanelWidth, 560);
  assert.equal(normalized.overlayPanelHeight, 360);
});

test('getOverlaySettingsPreview: should summarize enabled strategy', () => {
  const summary = overlayPanel.getOverlaySettingsPreview({
    enabled: true,
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    targetCefr: 'B2',
    activeLevels: ['CET4', 'IELTS'],
    reviewDanmakuSpeed: 'fast',
    vocabularyMode: 'full',
    examPreference: 'exam-first',
  });

  assert.match(summary, /20%/);
  assert.match(summary, /2 个词/);
  assert.match(summary, /B2/);
  assert.match(summary, /2 个词库/);
  assert.match(summary, /快/);
  assert.match(summary, /全量扩展/);
  assert.match(summary, /考试优先/);
});

test('getLearningProfile: should classify balanced strategy', () => {
  assert.deepEqual(
    overlayPanel.getLearningProfile({
      enabled: true,
      replaceRatio: 0.2,
      maxReplaceCount: 2,
    }),
    {
      tone: 'balanced',
      label: '均衡输入',
      summary: '兼顾剧情理解和稳定词汇曝光，适合日常长期使用',
    }
  );
});
