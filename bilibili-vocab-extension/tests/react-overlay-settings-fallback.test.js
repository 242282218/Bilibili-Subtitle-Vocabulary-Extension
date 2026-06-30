const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const OVERLAY_SETTINGS_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'lib',
  'overlay-settings.ts'
);

function transpileTsModule(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadOverlaySettingsWithoutSharedSettings() {
  const overlayCode = transpileTsModule(OVERLAY_SETTINGS_SOURCE_PATH);
  const moduleRef = { exports: {} };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require(id) {
      if (id === './settings-normalizer') {
        return {};
      }
      return require(id);
    },
    console,
    Date,
    JSON,
    Math,
    Promise,
    Set,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.runInNewContext(overlayCode, sandbox, { filename: 'overlay-settings.js' });
  return moduleRef.exports;
}

test('react overlay settings bridge: should fail when SharedSettings is missing', () => {
  assert.throws(
    () => loadOverlaySettingsWithoutSharedSettings(),
    /SharedSettings is required before React overlay settings bridge loads/
  );
});
