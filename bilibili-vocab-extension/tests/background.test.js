const test = require("node:test");
const assert = require("node:assert/strict");

const background = require("../background.js");

test("normalizeStoredSettings: 应将旧版 level 字段迁移为 activeLevels", () => {
  const migrated = background.normalizeStoredSettings({
    enabled: false,
    level: "cet6",
    replaceRatio: 0.22,
    targetCefr: "c1"
  });

  assert.equal(migrated.enabled, false);
  assert.equal(migrated.replaceRatio, 0.22);
  assert.deepEqual(migrated.activeLevels, ["CET6"]);
  assert.equal(migrated.maxReplaceCount, 2);
  assert.equal(migrated.targetCefr, "C1");
});

test("normalizeStoredSettings: 缺省配置应回落到 DEV_SPEC 默认值", () => {
  const normalized = background.normalizeStoredSettings({});

  assert.equal(normalized.enabled, true);
  assert.equal(normalized.reviewDanmakuEnabled, false);
  assert.equal(normalized.reviewDanmakuSpeed, "normal");
  assert.equal(normalized.replaceRatio, 0.2);
  assert.equal(normalized.maxReplaceCount, 2);
  assert.deepEqual(normalized.activeLevels, ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"]);
  assert.equal(normalized.targetCefr, "B2");
});

test("normalizeStoredSettings: 应保留独立复习弹幕开关", () => {
  const normalized = background.normalizeStoredSettings({
    reviewDanmakuEnabled: true
  });

  assert.equal(normalized.reviewDanmakuEnabled, true);
});

test("normalizeStoredSettings: 应保留独立复习弹幕速度档位", () => {
  const fast = background.normalizeStoredSettings({
    reviewDanmakuSpeed: "fast"
  });
  const fallback = background.normalizeStoredSettings({
    reviewDanmakuSpeed: "unknown"
  });

  assert.equal(fast.reviewDanmakuSpeed, "fast");
  assert.equal(fallback.reviewDanmakuSpeed, "normal");
});

test("normalizeStoredSettings: 应归一化站点规则并回写 schemaVersion", () => {
  const normalized = background.normalizeStoredSettings({
    domainRules: {
      "Example.COM": { enabled: false },
      "invalid host": { enabled: false }
    },
    schemaVersion: 99
  });

  assert.deepEqual(normalized.domainRules, {
    "example.com": { enabled: false }
  });
  assert.equal(normalized.schemaVersion, 2);
});
