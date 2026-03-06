const test = require("node:test");
const assert = require("node:assert/strict");

const scheduler = require("../scripts/scheduler.js");

test("computeWordWeight: should prioritize lower hitCount", () => {
  const low = scheduler.computeWordWeight({ hitCount: 1 });
  const high = scheduler.computeWordWeight({ hitCount: 10 });
  assert.ok(low > high);
});

test("levenshteinDistance: should return edit distance", () => {
  assert.equal(scheduler.levenshteinDistance("adopt", "adapt"), 1);
  assert.equal(scheduler.levenshteinDistance("system", "system"), 0);
});

test("buildAssociationCluster: should include typo-like and similar-translation words", () => {
  const seed = {
    word: "adopt",
    translation: "采用,采纳",
    hitCount: 1,
    lastSeen: 1
  };

  const pool = [
    seed,
    {
      word: "adapt",
      translation: "适应,改编",
      hitCount: 2,
      lastSeen: 2
    },
    {
      word: "accept",
      translation: "采用,接受",
      hitCount: 3,
      lastSeen: 3
    }
  ];

  const cluster = scheduler.buildAssociationCluster(seed, pool, new Set());
  const words = cluster.map((item) => item.word);

  assert.ok(words.includes("adapt"));
  assert.ok(words.includes("accept"));
});

test("createCooldownSet: should cap cooldown length by 60% of pool size and 30", () => {
  const queue = ["a", "b", "c", "d", "e", "f"];
  const cooldown = scheduler.createCooldownSet(queue, 5);
  assert.equal(cooldown.size, 3);
});

test("createSchedulerEngine: should not enqueue associated words before primary shot succeeds", () => {
  const calls = [];
  const outcomes = [false, true];
  let index = 0;

  const engine = scheduler.createSchedulerEngine({
    getVocabularyWords: () => [
      { word: "adopt", translation: "采用,采纳", hitCount: 1, lastSeen: 1 },
      { word: "adapt", translation: "适应,改编", hitCount: 5, lastSeen: 2 }
    ],
    shootDanmaku: (wordObj, isAssociated) => {
      calls.push({ word: wordObj.word, isAssociated });
      const outcome = outcomes[index];
      index += 1;
      return outcome;
    }
  });

  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    engine.tick();
    engine.tick();
  } finally {
    Math.random = originalRandom;
    engine.stop();
  }

  assert.deepEqual(calls, [
    { word: "adopt", isAssociated: false },
    { word: "adopt", isAssociated: false }
  ]);
});

test("createSchedulerEngine: should retry failed associated words before drawing a new primary word", () => {
  const calls = [];
  const outcomes = [true, false, true];
  let index = 0;

  const engine = scheduler.createSchedulerEngine({
    getVocabularyWords: () => [
      { word: "adopt", translation: "采用,采纳", hitCount: 1, lastSeen: 1 },
      { word: "adapt", translation: "适应,改编", hitCount: 5, lastSeen: 2 }
    ],
    shootDanmaku: (wordObj, isAssociated) => {
      calls.push({ word: wordObj.word, isAssociated });
      const outcome = outcomes[index];
      index += 1;
      return outcome;
    }
  });

  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    engine.tick();
    engine.tick();
    engine.tick();
  } finally {
    Math.random = originalRandom;
    engine.stop();
  }

  assert.deepEqual(calls, [
    { word: "adopt", isAssociated: false },
    { word: "adapt", isAssociated: true },
    { word: "adapt", isAssociated: true }
  ]);
});
