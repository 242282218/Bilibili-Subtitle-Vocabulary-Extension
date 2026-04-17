const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('overlay panel styles: should allow body region to scroll independently', () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(
    stylesheet,
    /\.bili-vocab-overlay__body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*-webkit-overflow-scrolling:\s*touch;[^}]*\}/s
  );
});
