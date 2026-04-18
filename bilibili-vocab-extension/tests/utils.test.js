const test = require('node:test');
const assert = require('node:assert/strict');

const utils = require('../utils.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('utils: should normalize text and word keys consistently', () => {
  assert.equal(utils.normalizeText('  hello \n   world\t '), 'hello world');
  assert.equal(utils.normalizeText(null), '');
  assert.equal(utils.normalizeWordKey('  HeLLo '), 'hello');
  assert.equal(utils.normalizeWordKey(undefined), '');
});

test('utils: should escape html-sensitive characters', () => {
  assert.equal(
    utils.escapeHtml(`<&>"'`),
    '&lt;&amp;&gt;&quot;&#39;'.replace('&lt;&amp;&gt;', '&lt;&amp;&gt;')
  );
  assert.equal(utils.escapeHtml('<tag attr="1">'), '&lt;tag attr=&quot;1&quot;&gt;');
});

test('utils: debounce should coalesce rapid calls and preserve latest args', async () => {
  const calls = [];
  const receiver = { label: 'receiver' };
  const debounced = utils.debounce(function (value) {
    calls.push({ value, label: this.label });
  }, 10);

  debounced.call({ label: 'first' }, 'a');
  debounced.call(receiver, 'b');
  await wait(25);

  assert.deepEqual(calls, [{ value: 'b', label: 'receiver' }]);
});

test('utils: logError should prefix context consistently', () => {
  const original = console.error;
  const entries = [];

  console.error = (...args) => {
    entries.push(args);
  };

  try {
    utils.logError('load failed', new Error('boom'));
  } finally {
    console.error = original;
  }

  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], '[BiliVocab] load failed:');
  assert.match(String(entries[0][1]), /boom/);
});

test('utils: LRUCache should evict oldest entry and refresh recent reads', () => {
  const cache = new utils.LRUCache(2);

  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);

  cache.set('c', 3);

  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.get('c'), 3);

  cache.clear();
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('c'), false);
});
