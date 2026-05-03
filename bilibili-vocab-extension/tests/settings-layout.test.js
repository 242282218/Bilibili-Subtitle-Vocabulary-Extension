const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

function readManifest() {
  const raw = readProjectFile('manifest.json').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

test('options layout: should assert the shipped react options entry instead of legacy options shell', () => {
  const manifest = readManifest();
  const optionsHtml = readProjectFile('react-ui/options.html');
  const optionsSource = readProjectFile('react-ui/src/options-main.tsx');

  assert.equal(manifest.options_page, 'dist/options.html');
  assert.match(optionsHtml, /id="root"/);
  assert.match(optionsHtml, /src="\/src\/options-main\.tsx"/);
  assert.match(optionsSource, /字幕学习设置/);
  assert.match(optionsSource, /基础设置/);
  assert.match(optionsSource, /学习策略/);
  assert.match(optionsSource, /复习弹幕密度/);
  assert.match(optionsSource, /双语显示模式/);
  assert.match(optionsSource, /主题模式/);
  assert.match(optionsSource, /站点规则/);
  assert.match(optionsSource, /非默认站点仍需在 Popup 对当前标签页授权/);
  assert.match(optionsSource, /需 Popup 授权/);
  assert.match(optionsSource, /启用自动调优/);
  assert.match(optionsSource, /近 7 天验收指标/);
  assert.match(optionsSource, /连续学习/);
  assert.match(optionsSource, /总学习天数/);
  assert.match(optionsSource, /数据与备份/);
  assert.match(optionsSource, /导出当前配置/);
  assert.match(optionsSource, /导入配置/);
  assert.match(optionsSource, /恢复默认设置/);
  assert.match(optionsSource, /清空已收藏生词/);
});

test('popup layout: should assert the shipped react popup entry instead of legacy popup shell', () => {
  const manifest = readManifest();
  const popupHtml = readProjectFile('react-ui/popup.html');
  const popupSource = readProjectFile('react-ui/src/popup-main.tsx');

  assert.equal(manifest.action && manifest.action.default_popup, 'dist/popup.html');
  assert.match(popupHtml, /id="root"/);
  assert.match(popupHtml, /src="\/src\/popup-main\.tsx"/);
  assert.match(popupSource, /当前页面学习助手/);
  assert.match(popupSource, /当前站点控制/);
  assert.match(popupSource, /实时学习预览/);
  assert.match(popupSource, /StudyPreview/);
  assert.match(popupSource, /快速复习/);
  assert.match(popupSource, /今日关键指标/);
  assert.match(popupSource, /连续学习/);
  assert.match(popupSource, /显示模式/);
  assert.match(popupSource, /主题模式/);
  assert.match(popupSource, /打开设置/);
});

test('shared styles: should define dashboard shell and single-column options layout', () => {
  const stylesheet = readProjectFile('styles.css');

  assert.match(stylesheet, /\.hub-page\s*\{/);
  assert.match(stylesheet, /\.hub-app-shell--single-column\s*\{/);
  assert.match(stylesheet, /\.hub-panel\s*\{/);
  assert.match(stylesheet, /\.hub-topbar__metrics\s*\{/);
});
