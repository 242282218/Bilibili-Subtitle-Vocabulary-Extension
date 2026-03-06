const test = require("node:test");
const assert = require("node:assert/strict");

const popup = require("../popup.js");

test("normalizeWordStat: should normalize missing fields", () => {
  const normalized = popup.normalizeWordStat({
    word: "  optimize ",
    meaning: "优化",
    hitCount: "3",
    lastSeen: "1700000000000"
  });

  assert.equal(normalized.word, "optimize");
  assert.equal(normalized.translation, "优化");
  assert.equal(normalized.hitCount, 3);
  assert.equal(normalized.lastSeen, 1700000000000);
});

test("sortEncounteredWords: asc should sort by hitCount then lastSeen", () => {
  const list = [
    { word: "b", hitCount: 2, lastSeen: 9 },
    { word: "a", hitCount: 1, lastSeen: 10 },
    { word: "c", hitCount: 2, lastSeen: 4 }
  ];

  const sorted = popup.sortEncounteredWords(list, "asc");
  assert.deepEqual(sorted.map((item) => item.word), ["a", "c", "b"]);
});

test("sortEncounteredWords: desc should sort by hitCount then lastSeen", () => {
  const list = [
    { word: "b", hitCount: 2, lastSeen: 9 },
    { word: "a", hitCount: 1, lastSeen: 10 },
    { word: "c", hitCount: 2, lastSeen: 4 }
  ];

  const sorted = popup.sortEncounteredWords(list, "desc");
  assert.deepEqual(sorted.map((item) => item.word), ["b", "c", "a"]);
});

test("normalizeReviewDanmakuEnabled: should default to false", () => {
  assert.equal(popup.normalizeReviewDanmakuEnabled(undefined), false);
  assert.equal(popup.normalizeReviewDanmakuEnabled(false), false);
  assert.equal(popup.normalizeReviewDanmakuEnabled(true), true);
});

test("getReviewDanmakuButtonLabel: should reflect current trigger state", () => {
  assert.equal(popup.getReviewDanmakuButtonLabel(false), "启动复习弹幕");
  assert.equal(popup.getReviewDanmakuButtonLabel(true), "停止复习弹幕");
});

test("normalizeReviewDanmakuSpeed: should default to normal", () => {
  assert.equal(popup.normalizeReviewDanmakuSpeed(undefined), "normal");
  assert.equal(popup.normalizeReviewDanmakuSpeed("fast"), "fast");
  assert.equal(popup.normalizeReviewDanmakuSpeed("SLOW"), "slow");
  assert.equal(popup.normalizeReviewDanmakuSpeed("unknown"), "normal");
});

test("getReviewDanmakuSpeedLabel: should reflect preset labels", () => {
  assert.equal(popup.getReviewDanmakuSpeedLabel("slow"), "慢");
  assert.equal(popup.getReviewDanmakuSpeedLabel("normal"), "标准");
  assert.equal(popup.getReviewDanmakuSpeedLabel("fast"), "快");
});
