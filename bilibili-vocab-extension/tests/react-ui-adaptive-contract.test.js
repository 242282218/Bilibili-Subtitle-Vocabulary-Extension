const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react ui adaptive contract: storage should expose adaptive state read/write helpers', () => {
  const source = readProjectFile('react-ui/src/storage.ts');

  assert.match(source, /export interface AdaptiveTuningState/);
  assert.match(source, /export interface ExperienceMetricsSnapshot/);
  assert.match(source, /export async function readAdaptiveTuningState\(\)/);
  assert.match(source, /export async function readExperienceMetricsSnapshot\(/);
  assert.match(source, /export async function setAdaptiveTuningEnabled\(/);
  assert.match(source, /adaptiveToggleEnabled|adaptiveToggleDisabled/);
  assert.match(source, /MESSAGE_TYPES\.SETTINGS_COMMIT/);
  assert.match(source, /MESSAGE_TYPES\.ADAPTIVE_SET_ENABLED/);
});

test('react ui adaptive contract: options should render adaptive tuning control and status', () => {
  const source = readProjectFile('react-ui/src/options-main.tsx');

  assert.match(source, /启用自动调优/);
  assert.match(source, /手动配置优先|手动覆盖/);
  assert.match(source, /近 7 天验收指标/);
});

test('react ui adaptive contract: popup should render adaptive tuning control and status', () => {
  const source = readProjectFile('react-ui/src/popup-main.tsx');

  assert.match(source, /启用自动调优/);
  assert.match(source, /自动调优状态/);
  assert.match(source, /adaptiveState \? adaptiveState\.hint/);
  assert.match(source, /近 7 天关键指标/);
});
