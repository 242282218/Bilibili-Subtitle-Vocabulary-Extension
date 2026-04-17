const test = require('node:test');
const assert = require('node:assert/strict');

const adaptiveTuning = require('../adaptiveTuning.js');
const sharedSettings = require('../sharedSettings.js');

test('adaptive tuning: should record normalized feedback into bounded window', () => {
  let state = adaptiveTuning.normalizeState(null);
  for (let index = 0; index < 20; index += 1) {
    state = adaptiveTuning.recordFeedback(
      state,
      index % 2 === 0 ? 'dontKnow' : 'know',
      1700000000000 + index
    );
  }

  assert.equal(state.feedbackWindow.length, state.windowLimit);
  assert.equal(state.feedbackWindow[0].action, 'dontknow');
  assert.equal(state.feedbackWindow[state.feedbackWindow.length - 1].action, 'know');
});

test('adaptive tuning: should decide ease-down when dontKnow dominates', () => {
  const feedbackWindow = [
    { action: 'dontknow', at: 1700000000000 },
    { action: 'dontknow', at: 1700000001000 },
    { action: 'dontknow', at: 1700000002000 },
    { action: 'dontknow', at: 1700000003000 },
    { action: 'fuzzy', at: 1700000004000 },
    { action: 'know', at: 1700000005000 },
  ];
  const state = adaptiveTuning.normalizeState({
    enabled: true,
    feedbackWindow,
  });

  const decision = adaptiveTuning.decideAdjustment(
    state,
    {
      replaceRatio: 0.2,
      maxReplaceCount: 2,
      reviewDanmakuSpeed: 'normal',
    },
    1700000006000
  );

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.mode, 'ease-down');
  assert.ok(decision.nextProfile.replaceRatio < 0.2);
  assert.ok(decision.nextProfile.maxReplaceCount <= 2);
  assert.equal(decision.nextProfile.reviewDanmakuSpeed, 'slow');
});

test('adaptive tuning: should decide ramp-up when know dominates', () => {
  const feedbackWindow = [
    { action: 'know', at: 1700000000000 },
    { action: 'know', at: 1700000001000 },
    { action: 'know', at: 1700000002000 },
    { action: 'know', at: 1700000003000 },
    { action: 'know', at: 1700000004000 },
    { action: 'fuzzy', at: 1700000005000 },
  ];
  const state = adaptiveTuning.normalizeState({
    enabled: true,
    feedbackWindow,
  });

  const decision = adaptiveTuning.decideAdjustment(
    state,
    {
      replaceRatio: 0.2,
      maxReplaceCount: 2,
      reviewDanmakuSpeed: 'slow',
    },
    1700000006000
  );

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.mode, 'ramp-up');
  assert.ok(decision.nextProfile.replaceRatio > 0.2);
  assert.ok(decision.nextProfile.maxReplaceCount >= 2);
  assert.equal(decision.nextProfile.reviewDanmakuSpeed, 'normal');
});

test('adaptive tuning: should respect manual override lock', () => {
  const state = adaptiveTuning.normalizeState({
    enabled: true,
    feedbackWindow: [
      { action: 'dontknow', at: 1700000000000 },
      { action: 'dontknow', at: 1700000001000 },
      { action: 'dontknow', at: 1700000002000 },
      { action: 'dontknow', at: 1700000003000 },
      { action: 'fuzzy', at: 1700000004000 },
      { action: 'know', at: 1700000005000 },
    ],
    manualOverrideUntil: 1700000600000,
  });

  const decision = adaptiveTuning.decideAdjustment(
    state,
    {
      replaceRatio: 0.2,
      maxReplaceCount: 2,
      reviewDanmakuSpeed: 'normal',
    },
    1700000010000
  );

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.reason, 'manual-override');
});

test('adaptive tuning: should patch active profile in v3 payload when adjustment is applied', () => {
  const settingsV3 = sharedSettings.normalizeSettingsV3({
    activeProfileId: 'balanced',
    profilesBuiltin: {
      balanced: {
        replaceRatio: 0.2,
        maxReplaceCount: 2,
        reviewDanmakuSpeed: 'normal',
        targetCefr: 'B2',
        activeLevels: ['CET4', 'CET6'],
        vocabularyMode: 'core',
        examPreference: 'balanced',
        enabled: true,
      },
    },
  });

  const payload = {
    [sharedSettings.SETTINGS_STORAGE_KEY_V3]: settingsV3,
    [adaptiveTuning.STORAGE_KEYS.STATE]: {
      enabled: true,
      feedbackWindow: [
        { action: 'dontknow', at: 1700000000000 },
        { action: 'dontknow', at: 1700000001000 },
        { action: 'dontknow', at: 1700000002000 },
        { action: 'dontknow', at: 1700000003000 },
        { action: 'fuzzy', at: 1700000004000 },
      ],
    },
  };

  const result = adaptiveTuning.applyFeedbackToPayload(payload, 'dontKnow', 1700000006000);
  assert.equal(result.applied, true);

  const runtime = sharedSettings.resolveEffectiveRuntime(result.nextSettingsV3, {
    hostname: 'www.bilibili.com',
  });
  assert.ok(runtime.replaceRatio <= 0.2);
  assert.ok(runtime.maxReplaceCount <= 2);
  assert.equal(runtime.reviewDanmakuSpeed, 'slow');
});
