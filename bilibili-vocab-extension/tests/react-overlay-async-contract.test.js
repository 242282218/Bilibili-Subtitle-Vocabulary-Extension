const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react overlay async contract: overlay entry should guard summary load failure', () => {
  const source = readProjectFile('react-ui/src/components/overlay-entry.tsx');

  assert.match(source, /学习概览读取失败，请稍后重试。/);
  assert.match(source, /subscribeLearningSummary/);
  assert.match(source, /最近词汇/);
  assert.match(source, /跟随学习状态实时刷新/);
});

test('react overlay async contract: persistImmediate should persist before committing UI state', () => {
  const source = readProjectFile('react-ui/src/components/overlay-entry.tsx');

  assert.match(
    source,
    /async function persistImmediate\(next: SettingsV3, message: string\) \{[\s\S]*const persisted = await saveOverlaySettingsV3\(next\);[\s\S]*setWorkingDirect\(persisted\);/
  );
  assert.doesNotMatch(
    source,
    /async function persistImmediate\(next: SettingsV3, message: string\) \{[\s\S]*setWorkingDirect\(next\);/
  );
  assert.match(source, /保存失败，请重试。/);
});
