const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react ui popup subtitle navigation contract: storage should expose active tab subtitle helpers', () => {
  const source = readProjectFile('react-ui/src/storage.ts');

  assert.match(source, /export async function readActiveTabSubtitleStatus/);
  assert.match(source, /export async function readActiveTabSubtitleNavigation/);
  assert.match(source, /export async function navigateActiveTabSubtitle/);
  assert.match(source, /export function subscribeActiveTabSubtitleStatus/);
  assert.match(source, /ACTIVE_TAB_SUBTITLE_NAVIGATION_READ/);
  assert.match(source, /ACTIVE_TAB_SUBTITLE_NAVIGATION_NAVIGATE/);
  assert.match(source, /ACTIVE_TAB_SUBTITLE_NAVIGATION_SUBSCRIBE/);
});

test('react ui popup subtitle navigation contract: popup should render current subtitle controls', () => {
  const source =
    readProjectFile('react-ui/src/popup-main.tsx') +
    '\n' +
    readProjectFile('react-ui/src/popup-sections.tsx') +
    '\n' +
    readProjectFile('react-ui/src/use-subtitle-status.ts');

  assert.match(source, /当前字幕导航/);
  assert.match(source, /直接控制当前标签页的上一句、重播和下一句/);
  assert.match(source, /readActiveTabSubtitleStatus/);
  assert.match(source, /navigateActiveTabSubtitle/);
  assert.match(source, /重播本句/);
  assert.match(source, /下一句/);
});

test('react ui popup subtitle navigation contract: popup should subscribe to active tab subtitle state while open', () => {
  const source =
    readProjectFile('react-ui/src/popup-main.tsx') +
    '\n' +
    readProjectFile('react-ui/src/use-subtitle-status.ts');

  assert.match(source, /readActiveTabSubtitleStatus/);
  assert.match(source, /subscribeActiveTabSubtitleStatus/);
  assert.doesNotMatch(source, /window\.setInterval/);
});
