const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react overlay subtitle navigation contract: overlay entry should render subtitle navigation card', () => {
  const source = readProjectFile('react-ui/src/overlay-entry.tsx');

  assert.match(source, /from ['"]\.\/subtitle-navigation['"]/);
  assert.match(source, /字幕导航/);
  assert.match(source, /上一句/);
  assert.match(source, /重播本句/);
  assert.match(source, /下一句/);
  assert.match(source, /buildSubtitleNavigationState/);
  assert.match(source, /seekVideoToSubtitle/);
  assert.match(source, /loadSubtitleTimeline\(\)/);
  assert.match(source, /location\.href/);
  assert.match(source, /subtitlePageUrlRef/);
});
