const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react ui learning loop contract: storage should expose quick review and ranking helpers', () => {
  const source = readProjectFile('react-ui/src/storage.ts');

  assert.match(source, /export interface QuickReviewDashboard/);
  assert.match(source, /export async function readQuickReviewDashboard\(/);
  assert.match(source, /export async function submitQuickReviewFeedback\(/);
  assert.match(source, /export async function readEncounteredWordRanking\(/);
  assert.match(source, /MESSAGE_TYPES\.ADAPTIVE_PERSIST_FEEDBACK/);
});

test('react ui learning loop contract: popup should render shipped quick review and ranking loop', () => {
  const source = readProjectFile('react-ui/src/popup-main.tsx');

  assert.match(source, /快速复习/);
  assert.match(source, /生词排行/);
  assert.match(source, /handleQuickReviewAction/);
  assert.match(source, /readEncounteredWordRanking/);
  assert.match(source, /submitQuickReviewFeedback/);
});
