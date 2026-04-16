const test = require("node:test");
const assert = require("node:assert/strict");

const options = require("../options.js");

test("options anki export: should build anki-compatible tsv payload", () => {
  const payload = options.buildVocabularyExportPayload([
    {
      word: "focus",
      translation: "聚焦",
      level: "CET4",
      savedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      details: {
        meaning: "专注\n集中",
        level: "CET4",
        phonetic: "/ˈfəʊkəs/"
      }
    }
  ], "anki");

  assert.equal(payload.extension, "tsv");
  assert.equal(payload.label, "ANKI-TSV");
  assert.equal(payload.mimeType, "text/tab-separated-values;charset=utf-8;");

  const [header, row] = payload.content.split("\n");
  assert.equal(header, "Front\tBack\tLevel\tPhonetic\tSavedAt");
  assert.match(row, /^focus\t专注 集中\tCET4\t\/ˈfəʊkəs\/\t2026-01-02T03:04:05.000Z$/);
});
