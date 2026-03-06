const test = require("node:test");
const assert = require("node:assert/strict");

const vocabulary = require("../vocabulary.js");

test("findMatchesInText: should match alias terms", () => {
  vocabulary.__setEntriesForTest([
    {
      word: "optimize",
      meaning: "\u4f18\u5316",
      aliases: ["\u6539\u8fdb"],
      level: "CET4"
    }
  ]);

  const matches = vocabulary.findMatchesInText("\u6211\u4eec\u9700\u8981\u6539\u8fdb\u5b57\u5e55\u7cfb\u7edf", ["CET4"]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].chinese, "\u6539\u8fdb");
  assert.equal(matches[0].word, "optimize");
});

test("findMatchesInText: should deduplicate repeated meaning terms", () => {
  vocabulary.__setEntriesForTest([
    {
      word: "strategy",
      meaning: "\u7b56\u7565;\u65b9\u6cd5",
      aliases: ["\u7b56\u7565", "\u65b9\u6848"],
      level: "CET6"
    }
  ]);

  const matches = vocabulary.findMatchesInText("\u8fd9\u4e2a\u7b56\u7565\u65b9\u6848\u5f88\u6709\u6548", ["CET6"]);
  const chineseTokens = matches.map((item) => item.chinese);
  assert.deepEqual(chineseTokens, ["\u7b56\u7565", "\u65b9\u6848"]);
});

test("recordHit: should increment hitCount and update lastSeen", () => {
  vocabulary.__setEntriesForTest([
    {
      word: "optimize",
      meaning: "\u4f18\u5316",
      aliases: ["\u6539\u8fdb"],
      level: "CET4"
    }
  ]);

  const before = Date.now();
  const result = vocabulary.recordHit("optimize");

  assert.equal(result, true);

  const encountered = vocabulary.getEncounteredWords();
  assert.equal(encountered.length, 1);
  assert.equal(encountered[0].word, "optimize");
  assert.equal(encountered[0].hitCount, 1);
  assert.ok(Number(encountered[0].lastSeen) >= before);
});

test("getEncounteredWords: should return only words with hitCount > 0", () => {
  vocabulary.__setEntriesForTest([
    { word: "alpha", meaning: "\u963f\u5c14\u6cd5", level: "CET4" },
    { word: "beta", meaning: "\u8d1d\u5854", level: "CET6" }
  ]);

  vocabulary.recordHit("beta");

  const encountered = vocabulary.getEncounteredWords();
  assert.deepEqual(encountered.map((item) => item.word), ["beta"]);
});
