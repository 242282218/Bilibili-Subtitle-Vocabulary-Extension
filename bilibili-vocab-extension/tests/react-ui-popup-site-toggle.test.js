const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const modulePath = path.join(__dirname, '..', 'react-ui', 'src', 'site-toggle-state.ts');
const popupPath = path.join(__dirname, '..', 'react-ui', 'src', 'popup-main.tsx');

function loadModule() {
  const source = fs.readFileSync(modulePath, 'utf8');
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
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'site-toggle-state.js' });
  return moduleRef.exports;
}

test('react ui popup site toggle: should disable control when hostname is unavailable', () => {
  const { getSiteToggleUiState } = loadModule();
  const result = getSiteToggleUiState({
    hostname: '',
    profileEnabled: true,
    siteRuleEnabled: true,
  });

  assert.equal(result.buttonDisabled, true);
  assert.equal(result.buttonLabel, '当前页面无法识别域名');
  assert.match(result.hint, /无法识别域名/);
});

test('react ui popup site toggle: should distinguish global-off state from site-off state', () => {
  const { getSiteToggleUiState } = loadModule();
  const result = getSiteToggleUiState({
    hostname: 'www.bilibili.com',
    profileEnabled: false,
    siteRuleEnabled: true,
  });

  assert.equal(result.buttonDisabled, true);
  assert.equal(result.buttonLabel, '总开关关闭中');
  assert.match(result.hint, /总开关当前关闭/);
  assert.match(result.hint, /站点规则保持启用/);
});

test('react ui popup site toggle: should expose restore action when only site rule is paused', () => {
  const { getSiteToggleUiState } = loadModule();
  const result = getSiteToggleUiState({
    hostname: 'www.bilibili.com',
    profileEnabled: true,
    siteRuleEnabled: false,
  });

  assert.equal(result.buttonDisabled, false);
  assert.equal(result.buttonLabel, '恢复当前站点');
  assert.match(result.hint, /站点规则处于暂停状态/);
});

test('react ui popup site toggle: should expose optional permission authorization before restoring non-default sites', () => {
  const source =
    fs.readFileSync(popupPath, 'utf8') +
    '\n' +
    fs.readFileSync(path.join(__dirname, '..', 'react-ui', 'src', 'popup-sections.tsx'), 'utf8') +
    '\n' +
    fs.readFileSync(
      path.join(__dirname, '..', 'react-ui', 'src', 'use-site-permission.ts'),
      'utf8'
    );

  assert.match(source, /readActiveTabSitePermissionState/);
  assert.match(source, /requestActiveTabSitePermission/);
  assert.match(source, /removeActiveTabSitePermission/);
  assert.match(source, /授权当前站点/);
  assert.match(source, /撤销授权/);
  assert.match(source, /拒绝授权不会恢复站点规则/);
  assert.match(source, /需要先授权当前站点/);
});
