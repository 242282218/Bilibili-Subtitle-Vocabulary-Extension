const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LEVELS = ["cet4", "cet6", "kaoyan", "ielts", "toefl"];
const MIN_ENTRIES_BY_LEVEL = {
  cet4: 500,
  cet6: 500,
  kaoyan: 500,
  ielts: 1000,
  toefl: 1000
};
const UTF8_BOM = "\uFEFF";

function readRawLevel(level) {
  const filePath = path.join(__dirname, "..", "data", `${level}.json`);
  return fs.readFileSync(filePath, "utf8");
}

function readLevel(level) {
  const raw = readRawLevel(level);
  const cleaned = raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;
  return JSON.parse(cleaned);
}

test("开源词库导入后，各等级数据量应达到可用规模", () => {
  LEVELS.forEach((level) => {
    const entries = readLevel(level);
    assert.ok(entries.length >= MIN_ENTRIES_BY_LEVEL[level], `${level} 词条数量过少: ${entries.length}`);
  });
});

test("开源词库词条字段完整性", () => {
  LEVELS.forEach((level) => {
    const entries = readLevel(level);
    const sample = entries[0];
    assert.ok(sample.word && typeof sample.word === "string");
    assert.ok(sample.meaning && typeof sample.meaning === "string");
    assert.equal(sample.word, sample.word.toLowerCase());
    assert.equal(sample.level.toUpperCase(), level.toUpperCase());
    assert.ok(typeof sample.cefrLevel === "string");
    assert.ok(Number.isInteger(sample.cefrRank));
    assert.ok(typeof sample.frequency === "number");
    assert.ok(Array.isArray(sample.aliases));
  });
});

test("词库数据文件应使用 UTF-8 无 BOM 编码，避免 JSON 解析兼容性问题", () => {
  LEVELS.forEach((level) => {
    const raw = readRawLevel(level);
    assert.equal(raw.startsWith(UTF8_BOM), false, `${level}.json 包含 BOM`);
  });
});
