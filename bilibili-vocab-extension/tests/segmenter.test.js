const test = require("node:test");
const assert = require("node:assert/strict");

const segmenter = require("../segmenter.js");

test("segment: 应按中英文与标点切分字幕文本", () => {
  const tokens = segmenter.segment("我们需要优化字幕系统, improve efficiency!");

  assert.ok(Array.isArray(tokens));
  assert.deepEqual(tokens, [
    "我们",
    "需要",
    "优化",
    "字幕",
    "系统",
    ",",
    "improve",
    "efficiency",
    "!"
  ]);
});
