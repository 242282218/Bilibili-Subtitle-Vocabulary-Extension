const test = require('node:test');
const assert = require('node:assert/strict');

const subtitleParser = require('../subtitleParser.js');

test('isInjectedSubtitleElement: injected vocab span should be skipped as subtitle candidate', () => {
  const injected = {
    classList: {
      contains(name) {
        return name === 'bsv-word';
      },
    },
    closest(selector) {
      return selector === '.bsv-word' ? this : null;
    },
  };

  const plain = {
    classList: {
      contains() {
        return false;
      },
    },
    closest() {
      return null;
    },
  };

  assert.equal(subtitleParser.isInjectedSubtitleElement(injected), true);
  assert.equal(subtitleParser.isInjectedSubtitleElement(plain), false);
});
