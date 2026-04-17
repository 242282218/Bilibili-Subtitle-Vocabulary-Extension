const test = require('node:test');
const assert = require('node:assert/strict');

const options = require('../options.js');

test('options anki export: should build anki-compatible tsv payload', () => {
  const payload = options.buildVocabularyExportPayload(
    [
      {
        word: 'focus',
        translation: '聚焦',
        level: 'CET4',
        savedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
        details: {
          meaning: '专注\n集中',
          level: 'CET4',
          phonetic: '/ˈfəʊkəs/',
        },
      },
    ],
    'anki'
  );

  assert.equal(payload.extension, 'tsv');
  assert.equal(payload.label, 'ANKI-TSV');
  assert.equal(payload.mimeType, 'text/tab-separated-values;charset=utf-8;');

  const [header, row] = payload.content.split('\n');
  assert.equal(header, 'Front\tBack\tLevel\tPhonetic\tSavedAt');
  assert.match(row, /^focus\t专注 集中\tCET4\t\/ˈfəʊkəs\/\t2026-01-02T03:04:05.000Z$/);
});

test('options export payload: should ignore malformed word records', () => {
  const payload = options.buildVocabularyExportPayload(
    [
      null,
      42,
      {},
      { status: 'saved', details: { meaning: 'missing-word' } },
      {
        word: 'focus',
        translation: '聚焦',
        details: { meaning: '专注' },
        savedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      },
    ],
    'anki'
  );

  const rows = payload.content.split('\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0], 'Front\tBack\tLevel\tPhonetic\tSavedAt');
  assert.match(rows[1], /^focus\t专注\t\t\t2026-01-02T03:04:05.000Z$/);
});
