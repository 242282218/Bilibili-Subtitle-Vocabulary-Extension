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
  const optionsSource = readProjectFile('react-ui/src/components/options-main.tsx');
  const optionsSections = readProjectFile('react-ui/src/components/options-sections.tsx');
  const combinedOptions = optionsSource + '\n' + optionsSections;

  assert.equal(manifest.options_page, 'dist/options.html');
  assert.match(optionsHtml, /id="root"/);
  assert.match(optionsHtml, /src="\/src\/components\/options-main\.tsx"/);
  assert.match(combinedOptions, /字幕学习设置/);
  assert.match(combinedOptions, /基础设置/);
  assert.match(combinedOptions, /学习策略/);
  assert.match(combinedOptions, /复习弹幕密度/);
  assert.match(combinedOptions, /双语显示模式/);
  assert.match(combinedOptions, /主题模式/);
  assert.match(combinedOptions, /站点规则/);
  assert.match(combinedOptions, /非默认站点仍需在 Popup 对当前标签页授权/);
  assert.match(combinedOptions, /需 Popup 授权/);
  assert.match(combinedOptions, /启用自动调优/);
  assert.match(combinedOptions, /近 7 天验收指标/);
  assert.match(combinedOptions, /连续学习/);
  assert.match(combinedOptions, /总学习天数/);
  assert.match(combinedOptions, /数据与备份/);
  assert.match(combinedOptions, /导出当前配置/);
  assert.match(combinedOptions, /导入配置/);
  assert.match(combinedOptions, /恢复默认设置/);
  assert.match(combinedOptions, /清空已收藏生词/);
});

test('popup layout: should assert the shipped react popup entry instead of legacy popup shell', () => {
  const manifest = readManifest();
  const popupHtml = readProjectFile('react-ui/popup.html');
  const popupSource = readProjectFile('react-ui/src/components/popup-main.tsx');
  const popupSections = readProjectFile('react-ui/src/components/popup-sections.tsx');
  const combinedPopup = popupSource + '\n' + popupSections;

  assert.equal(manifest.action && manifest.action.default_popup, 'dist/popup.html');
  assert.match(popupHtml, /id="root"/);
  assert.match(popupHtml, /src="\/src\/components\/popup-main\.tsx"/);
  assert.match(combinedPopup, /字幕学习助手/);
  assert.match(combinedPopup, /当前站点控制/);
  assert.match(combinedPopup, /实时学习预览/);
  assert.match(combinedPopup, /StudyPreview/);
  assert.match(combinedPopup, /快速复习/);
  assert.match(combinedPopup, /今日关键指标/);
  assert.match(combinedPopup, /连续学习/);
  assert.match(combinedPopup, /显示模式/);
  assert.match(combinedPopup, /主题模式/);
  assert.match(combinedPopup, /打开设置/);
});

test('shared styles: should define dashboard shell and single-column options layout', () => {
  const stylesheet = readProjectFile('styles.css');

  assert.match(stylesheet, /\.hub-page\s*\{/);
  assert.match(stylesheet, /\.hub-app-shell--single-column\s*\{/);
  assert.match(stylesheet, /\.hub-panel\s*\{/);
  assert.match(stylesheet, /\.hub-topbar__metrics\s*\{/);
});
