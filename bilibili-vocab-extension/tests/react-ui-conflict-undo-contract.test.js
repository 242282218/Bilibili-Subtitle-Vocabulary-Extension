const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react ui conflict/undo contract: use-v3-settings should expose conflict resolution api', () => {
  const source = readProjectFile('react-ui/src/use-v3-settings.ts');

  assert.match(source, /export interface V3SettingsConflict/);
  assert.match(source, /conflict:\s*V3SettingsConflict \| null/);
  assert.match(source, /resolveConflictUseRemote/);
  assert.match(source, /resolveConflictUseLocal/);
  assert.match(source, /检测到外部更新：可应用远端版本，或保存本地版本覆盖。/);
});

test('react ui conflict/undo contract: options should render conflict actions and undo window', () => {
  const source =
    readProjectFile('react-ui/src/options-main.tsx') +
    '\n' +
    readProjectFile('react-ui/src/options-sections.tsx');

  assert.match(source, /检测到并发修改/);
  assert.match(source, /应用远端版本/);
  assert.match(source, /应用本地版本/);
  assert.match(source, /6 秒内可撤销/);
  assert.match(source, /撤销该操作/);
});

test('react ui conflict/undo contract: popup should render conflict actions and undo window', () => {
  const source =
    readProjectFile('react-ui/src/popup-main.tsx') +
    '\n' +
    readProjectFile('react-ui/src/popup-sections.tsx');

  assert.match(source, /检测到并发修改/);
  assert.match(source, /应用远端版本/);
  assert.match(source, /应用本地版本/);
  assert.match(source, /6 秒内可撤销/);
  assert.match(source, /撤销该操作/);
});
