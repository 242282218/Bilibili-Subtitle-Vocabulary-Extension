const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react ui async refresh contract: options should guard adaptive refresh failures', () => {
  const source =
    readProjectFile('react-ui/src/options-main.tsx') +
    '\n' +
    readProjectFile('react-ui/src/use-adaptive-tuning.ts');

  assert.match(source, /自动调优状态读取失败，请稍后重试。/);
  assert.match(source, /自动调优状态刷新失败，请稍后重试。/);
  assert.match(source, /切换自动调优失败，请稍后重试。/);
  assert.match(
    source,
    /Promise\.all\(\[readAdaptiveTuningState\(\), readExperienceMetricsSnapshot\(7\)\]\)[\s\S]*\.catch\(\(\) => \{[\s\S]*setStatus\('自动调优状态读取失败，请稍后重试。'\)/
  );
});

test('react ui async refresh contract: popup should guard overview and adaptive refresh failures', () => {
  const source =
    readProjectFile('react-ui/src/popup-main.tsx') +
    '\n' +
    readProjectFile('react-ui/src/use-quick-review.ts') +
    '\n' +
    readProjectFile('react-ui/src/use-adaptive-tuning.ts');

  assert.match(source, /学习概览读取失败，请稍后重试。/);
  assert.match(source, /学习数据读取失败，请稍后重试。/);
  assert.match(source, /生词排行读取失败，请稍后重试。/);
  assert.match(source, /快速复习保存失败，请重试。/);
  assert.match(source, /自动调优状态读取失败，请稍后重试。/);
  assert.match(source, /策略已保存，但自动调优状态刷新失败，请稍后重试。/);
  assert.match(source, /切换自动调优失败，请稍后重试。/);
});
