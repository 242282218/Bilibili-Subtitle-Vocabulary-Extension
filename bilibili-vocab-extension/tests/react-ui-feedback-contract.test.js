const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
}

test("react ui feedback contract: use-v3-settings should expose normalized feedback with status codes", () => {
  const source = readProjectFile("react-ui/src/use-v3-settings.ts");

  assert.match(source, /export interface SettingsUiFeedback/);
  assert.match(source, /statusCode:\s*string/);
  assert.match(source, /feedback:\s*SettingsUiFeedback \| null/);
  assert.match(source, /S_INIT_SYNCED/);
  assert.match(source, /P_SAVE_START/);
  assert.match(source, /S_SAVE_OK/);
  assert.match(source, /E_SAVE_FAILED/);
  assert.match(source, /W_EXTERNAL_CONFLICT/);
});

test("react ui feedback contract: options should render status code and suggestion", () => {
  const source = readProjectFile("react-ui/src/options-main.tsx");

  assert.match(source, /statusCode \? `（\$\{statusCode\}）` : (""|'')/);
  assert.match(source, /feedback && feedback\.suggestion/);
  assert.match(source, /冲突范围：\{conflict\.summary\}/);
});

test("react ui feedback contract: popup should render status code and suggestion", () => {
  const source = readProjectFile("react-ui/src/popup-main.tsx");

  assert.match(source, /statusCode \? `（\$\{statusCode\}）` : (""|'')/);
  assert.match(source, /feedback && feedback\.suggestion/);
  assert.match(source, /冲突范围：\{conflict\.summary\}/);
});

test("react ui feedback contract: onSave should keep error feedback when persistence fails", () => {
  const optionsSource = readProjectFile("react-ui/src/options-main.tsx");
  const popupSource = readProjectFile("react-ui/src/popup-main.tsx");

  assert.match(
    optionsSource,
    /const persisted = await save\('配置已保存并应用到扩展。'\);[\s\S]*if \(!persisted\)\s*\{\s*return;\s*\}/
  );
  assert.match(
    popupSource,
    /const persisted = await save\('策略已保存。'\);[\s\S]*if \(!persisted\)\s*\{\s*return;\s*\}/
  );
});
