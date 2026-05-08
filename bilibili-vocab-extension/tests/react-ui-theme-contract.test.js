const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const PROJECT_ROOT = path.join(__dirname, '..');
const UI_THEME_SOURCE_PATH = path.join(PROJECT_ROOT, 'react-ui', 'src', 'ui-theme.ts');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(PROJECT_ROOT, fileName), 'utf8');
}

function loadUiThemeModule() {
  const source = fs.readFileSync(UI_THEME_SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleRef = { exports: {} };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require(id) {
      if (id === 'react') {
        return {
          useEffect() {},
          useState(initialValue) {
            return [typeof initialValue === 'function' ? initialValue() : initialValue, () => {}];
          },
        };
      }
      if (id === './settings-bridge') {
        return {};
      }
      return require(id);
    },
    window: {},
    console,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'ui-theme.js' });
  return moduleRef.exports;
}

test('react ui theme contract: theme helper should resolve explicit and auto modes', () => {
  const uiTheme = loadUiThemeModule();

  assert.equal(uiTheme.resolveThemeMode('light', true), 'light');
  assert.equal(uiTheme.resolveThemeMode('dark', false), 'dark');
  assert.equal(uiTheme.resolveThemeMode('auto', true), 'dark');
  assert.equal(uiTheme.resolveThemeMode('auto', false), 'light');
  assert.equal(uiTheme.getThemeModeLabel('auto'), '跟随系统');
});

test('react ui theme contract: shipped popup/options/overlay should expose theme mode in real entry', () => {
  const optionsSource = readProjectFile('react-ui/src/options-main.tsx');
  const optionsSections = readProjectFile('react-ui/src/options-sections.tsx');
  const combinedOptions = optionsSource + '\n' + optionsSections;
  const popupSource = readProjectFile('react-ui/src/popup-main.tsx');
  const overlaySource = readProjectFile('react-ui/src/overlay-entry.tsx');

  assert.match(combinedOptions, /主题模式/);
  assert.match(optionsSource, /useDocumentTheme/);
  assert.match(combinedOptions, /themeMode/);
  assert.match(popupSource, /popupThemeMode/);
  assert.match(popupSource, /useDocumentTheme/);
  assert.match(overlaySource, /rvTheme/);
  assert.match(overlaySource, /data-theme=\{resolvedTheme\}/);
});

test('react ui theme contract: shipped css should provide light and dark theme hooks', () => {
  const uiCss = readProjectFile('react-ui/src/ui.css');
  const overlayCss = readProjectFile('react-ui/src/overlay.css');

  assert.match(uiCss, /body\.v3-page\[data-ui-theme="dark"\]/);
  assert.match(overlayCss, /\.rv-overlay-root\[data-theme="light"\]/);
});
