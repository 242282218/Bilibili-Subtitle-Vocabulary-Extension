const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react ui shortcuts contract: should define shipped shortcut guide metadata', () => {
  const source = readProjectFile('react-ui/src/shortcut-guide.tsx');

  assert.match(source, /切换字幕替换/);
  assert.match(source, /切换悬浮面板/);
  assert.match(source, /提高替换比例/);
  assert.match(source, /降低替换比例/);
  assert.match(source, /Ctrl\+Shift\+E/);
  assert.match(source, /Ctrl\+Shift\+O/);
  assert.match(source, /Ctrl\+Shift\+↑/);
  assert.match(source, /Ctrl\+Shift\+↓/);
  assert.match(source, /chrome:\/\/extensions\/shortcuts/);
  assert.match(source, /macOS 使用 Command 替代 Ctrl/);
});

test('react ui shortcuts contract: options should render shortcut guide in shipped entry', () => {
  const source = readProjectFile('react-ui/src/options-main.tsx');

  assert.match(source, /import \{ ShortcutGuide \} from '.\/shortcut-guide'/);
  assert.match(source, /<ShortcutGuide \/>/);
});

test('react ui shortcuts contract: popup should render shortcut guide in shipped entry', () => {
  const source = readProjectFile('react-ui/src/popup-main.tsx');

  assert.match(source, /import \{ ShortcutGuide \} from '.\/shortcut-guide'/);
  assert.match(source, /<ShortcutGuide title="快捷键速览" compact \/>/);
});
