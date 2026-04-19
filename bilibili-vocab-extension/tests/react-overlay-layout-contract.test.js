const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react overlay layout contract: overlay body should remain scrollable inside fixed panel', () => {
  const stylesheet = readProjectFile('react-ui/src/overlay.css');

  assert.match(
    stylesheet,
    /\.rv-overlay-panel\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:\s*auto 1fr;/
  );
  assert.match(stylesheet, /\.rv-overlay-body\s*\{[\s\S]*overflow:\s*auto;/);
});

test('react overlay layout contract: mountOverlayPanel should short-circuit when react root already exists', () => {
  const source = readProjectFile('react-ui/src/overlay-entry.tsx');

  assert.match(
    source,
    /function mountOverlayPanel\(\): void \{[\s\S]*document\.getElementById\(ROOT_ID\)[\s\S]*return;/
  );
  assert.match(
    source,
    /if \(!document\.getElementById\(STYLE_ID\)\) \{[\s\S]*styleNode\.id = STYLE_ID;/
  );
});
