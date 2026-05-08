const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react ui learning loop contract: storage should expose quick review, ranking and streak helpers', () => {
  const source = readProjectFile('react-ui/src/storage.ts');

  assert.match(source, /export interface QuickReviewDashboard/);
  assert.match(source, /export async function readQuickReviewDashboard\(/);
  assert.match(source, /export async function submitQuickReviewFeedback\(/);
  assert.match(source, /export async function readEncounteredWordRanking\(/);
  assert.match(source, /export async function readLearningStreak\(/);
  assert.match(source, /export function subscribeLearningStreak\(/);
  assert.match(source, /touchLearningStreak/);
  assert.match(source, /MESSAGE_TYPES\.ADAPTIVE_PERSIST_FEEDBACK/);
});

test('react ui learning loop contract: popup should render shipped quick review, ranking and streak loop', () => {
  const source =
    readProjectFile('react-ui/src/popup-main.tsx') +
    '\n' +
    readProjectFile('react-ui/src/popup-sections.tsx') +
    '\n' +
    readProjectFile('react-ui/src/use-quick-review.ts') +
    '\n' +
    readProjectFile('react-ui/src/use-learning-streak.ts');

  assert.match(source, /快速复习/);
  assert.match(source, /生词排行/);
  assert.match(source, /连续学习/);
  assert.match(source, /handleQuickReviewAction/);
  assert.match(source, /readEncounteredWordRanking/);
  assert.match(source, /submitQuickReviewFeedback/);
  assert.match(source, /readLearningStreak/);
  assert.match(source, /subscribeLearningStreak/);
});

test('react ui learning loop contract: runtime vocabulary flow should touch learning streak', () => {
  const source = readProjectFile('vocabulary.js');

  assert.match(source, /updateLearningStreak\(now\)/);
});
