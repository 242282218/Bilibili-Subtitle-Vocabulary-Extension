const test = require('node:test');
const assert = require('node:assert/strict');

const translator = require('../translator.js');

test('normalizeSettings: 应归一化 replaceRatio、maxReplaceCount、activeLevels', () => {
  const normalized = translator.normalizeSettings({
    replaceRatio: 1,
    maxReplaceCount: -10,
    activeLevels: ['cet6', 'toefl', 'unknown'],
    targetCefr: 'x1',
  });

  assert.equal(normalized.replaceRatio, 0.3);
  assert.equal(normalized.maxReplaceCount, 1);
  assert.deepEqual(normalized.activeLevels, ['CET6', 'TOEFL']);
  assert.equal(normalized.targetCefr, 'B2');
});

test('selectMatches: 应优先高等级词并遵守单句替换上限', () => {
  const matches = [
    { start: 0, end: 2, word: 'system', level: 'CET4' },
    { start: 3, end: 5, word: 'strategy', level: 'CET6' },
    { start: 6, end: 8, word: 'optimize', level: 'KAOYAN' },
    { start: 9, end: 11, word: 'enhance', level: 'IELTS' },
    { start: 12, end: 14, word: 'innovation', level: 'TOEFL' },
  ];

  const selected = translator.selectMatches(matches, {
    replaceRatio: 0.3,
    maxReplaceCount: 2,
  });

  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((item) => item.level),
    ['TOEFL', 'IELTS']
  );
});

test('selectMatches: 在替换名额受限时应优先避免同一英文词重复出现', () => {
  const matches = [
    { start: 0, end: 2, word: 'system', level: 'TOEFL' },
    { start: 3, end: 5, word: 'system', level: 'TOEFL' },
    { start: 6, end: 8, word: 'strategy', level: 'IELTS' },
    { start: 9, end: 11, word: 'method', level: 'CET4' },
    { start: 12, end: 14, word: 'result', level: 'CET4' },
    { start: 15, end: 17, word: 'problem', level: 'CET4' },
    { start: 18, end: 20, word: 'model', level: 'CET4' },
  ];

  const selected = translator.selectMatches(matches, {
    replaceRatio: 0.3,
    maxReplaceCount: 2,
  });

  assert.deepEqual(
    selected.map((item) => item.word),
    ['system', 'strategy']
  );
});

test('createSettingsFingerprint: 相同配置应生成稳定指纹且不受等级顺序影响', () => {
  const fingerprintA = translator.createSettingsFingerprint({
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    activeLevels: ['TOEFL', 'CET4', 'IELTS'],
  });

  const fingerprintB = translator.createSettingsFingerprint({
    replaceRatio: 0.2,
    maxReplaceCount: 2,
    activeLevels: ['IELTS', 'TOEFL', 'CET4'],
  });

  assert.equal(typeof fingerprintA, 'string');
  assert.equal(fingerprintA, fingerprintB);
});

test('selectMatches: 同等级候选词应优先接近目标 CEFR 难度', () => {
  const matches = [
    { start: 0, end: 2, word: 'alpha', level: 'TOEFL', cefrRank: 1 },
    { start: 3, end: 5, word: 'bravo', level: 'TOEFL', cefrRank: 4 },
    { start: 6, end: 8, word: 'charlie', level: 'TOEFL', cefrRank: 6 },
    { start: 9, end: 11, word: 'delta', level: 'TOEFL', cefrRank: 6 },
    { start: 12, end: 14, word: 'echo', level: 'TOEFL', cefrRank: 6 },
  ];

  const selected = translator.selectMatches(matches, {
    replaceRatio: 0.1,
    maxReplaceCount: 1,
    targetCefr: 'B2',
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].word, 'bravo');
});

test('selectMatches: 在其他条件接近时应优先词频更高的候选词', () => {
  const matches = [
    { start: 0, end: 2, word: 'rareword', level: 'IELTS', cefrRank: 4, frequency: 10 },
    { start: 3, end: 5, word: 'common', level: 'IELTS', cefrRank: 4, frequency: 1000000 },
    { start: 6, end: 8, word: 'filler1', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 9, end: 11, word: 'filler2', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 12, end: 14, word: 'filler3', level: 'CET4', cefrRank: 1, frequency: 10 },
  ];

  const selected = translator.selectMatches(matches, {
    replaceRatio: 0.1,
    maxReplaceCount: 1,
    targetCefr: 'B2',
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].word, 'common');
});

test('selectMatches: core 模式下应优先选择核心高频词', () => {
  const matches = [
    {
      start: 0,
      end: 2,
      word: 'outline',
      level: 'CET6',
      coverageTier: 'full',
      examPriorityScore: 10,
      examFrequencyScore: 10,
      cefrRank: 4,
      frequency: 100,
    },
    {
      start: 3,
      end: 5,
      word: 'approach',
      level: 'CET6',
      coverageTier: 'core',
      examPriorityScore: 8,
      examFrequencyScore: 8,
      cefrRank: 4,
      frequency: 50,
    },
    { start: 6, end: 8, word: 'filler1', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 9, end: 11, word: 'filler2', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 12, end: 14, word: 'filler3', level: 'CET4', cefrRank: 1, frequency: 10 },
  ];

  const selected = translator.selectMatches(matches, {
    replaceRatio: 0.1,
    maxReplaceCount: 1,
    vocabularyMode: 'core',
    targetCefr: 'B2',
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].word, 'approach');
});

test('selectMatches: exam-first 模式下应优先考试权重更高的词', () => {
  const matches = [
    {
      start: 0,
      end: 2,
      word: 'candidate',
      level: 'KAOYAN',
      coverageTier: 'core',
      examPriorityScore: 50,
      examFrequencyScore: 5000,
      cefrRank: 4,
      frequency: 500,
    },
    {
      start: 3,
      end: 5,
      word: 'common',
      level: 'KAOYAN',
      coverageTier: 'core',
      examPriorityScore: 5,
      examFrequencyScore: 50,
      cefrRank: 4,
      frequency: 1000000,
    },
    { start: 6, end: 8, word: 'filler1', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 9, end: 11, word: 'filler2', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 12, end: 14, word: 'filler3', level: 'CET4', cefrRank: 1, frequency: 10 },
  ];

  const selected = translator.selectMatches(matches, {
    replaceRatio: 0.1,
    maxReplaceCount: 1,
    vocabularyMode: 'full',
    examPreference: 'exam-first',
    targetCefr: 'B2',
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].word, 'candidate');
});

test('selectMatches: should prioritize learning words over mastered words when scores are otherwise close', () => {
  const matches = [
    {
      start: 0,
      end: 2,
      word: 'revise',
      level: 'CET6',
      coverageTier: 'core',
      examPriorityScore: 20,
      examFrequencyScore: 100,
      cefrRank: 4,
      frequency: 1000,
      learningStatus: 'mastered',
    },
    {
      start: 3,
      end: 5,
      word: 'retain',
      level: 'CET6',
      coverageTier: 'core',
      examPriorityScore: 20,
      examFrequencyScore: 100,
      cefrRank: 4,
      frequency: 1000,
      learningStatus: 'learning',
    },
    { start: 6, end: 8, word: 'filler1', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 9, end: 11, word: 'filler2', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 12, end: 14, word: 'filler3', level: 'CET4', cefrRank: 1, frequency: 10 },
  ];

  const selected = translator.selectMatches(matches, {
    replaceRatio: 0.1,
    maxReplaceCount: 1,
    vocabularyMode: 'core',
    examPreference: 'balanced',
    targetCefr: 'B2',
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].word, 'retain');
});

test('selectMatches: should skip candidates tagged as proper noun/url/code fragments', () => {
  const matches = [
    {
      start: 0,
      end: 2,
      word: 'youtube',
      level: 'TOEFL',
      sourceFlags: ['proper_noun'],
    },
    {
      start: 3,
      end: 5,
      word: 'optimize',
      level: 'CET4',
    },
  ];

  const selected = translator.selectMatches(matches, {
    replaceRatio: 0.1,
    maxReplaceCount: 1,
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].word, 'optimize');
});

test('selectMatches: should skip url-like context candidates when source text is provided', () => {
  const text = '访问 https://example.com/优化 后再学习优化';
  const first = text.indexOf('优化');
  const second = text.lastIndexOf('优化');
  const matches = [
    {
      start: first,
      end: first + 2,
      word: 'optimize',
      level: 'TOEFL',
    },
    {
      start: second,
      end: second + 2,
      word: 'strategy',
      level: 'CET4',
    },
  ];

  const selected = translator.selectMatches(
    matches,
    {
      replaceRatio: 0.1,
      maxReplaceCount: 1,
    },
    text
  );

  assert.equal(selected.length, 1);
  assert.equal(selected[0].word, 'strategy');
});

test('selectMatches: should prioritize phrase-backed candidates when other scores are close', () => {
  const matches = [
    {
      start: 0,
      end: 2,
      word: 'execute',
      level: 'CET6',
      coverageTier: 'core',
      examPriorityScore: 10,
      examFrequencyScore: 100,
      frequency: 2000,
      cefrRank: 4,
      isPhraseBacked: false,
      phraseCount: 0,
    },
    {
      start: 3,
      end: 5,
      word: 'carry out',
      level: 'CET6',
      coverageTier: 'core',
      examPriorityScore: 10,
      examFrequencyScore: 100,
      frequency: 2000,
      cefrRank: 4,
      isPhraseBacked: true,
      phraseCount: 6,
    },
    { start: 6, end: 8, word: 'filler1', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 9, end: 11, word: 'filler2', level: 'CET4', cefrRank: 1, frequency: 10 },
    { start: 12, end: 14, word: 'filler3', level: 'CET4', cefrRank: 1, frequency: 10 },
  ];

  const selected = translator.selectMatches(matches, {
    replaceRatio: 0.1,
    maxReplaceCount: 1,
    vocabularyMode: 'core',
    examPreference: 'balanced',
    targetCefr: 'B2',
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].word, 'carry out');
});

test('selectMatches: should deprioritize words under dynamic cooldown', () => {
  translator.__resetContextFeedbackForTest();

  translator.reportContextMisreplace('optimize', { now: 1700000000000, severity: 'high' });
  translator.reportContextMisreplace('optimize', { now: 1700000001000, severity: 'high' });

  const selected = translator.selectMatches(
    [
      { start: 0, end: 2, word: 'optimize', level: 'TOEFL' },
      { start: 3, end: 5, word: 'strategy', level: 'CET4' },
    ],
    {
      replaceRatio: 0.1,
      maxReplaceCount: 1,
    },
    {
      sourceText: '我们优化策略',
      now: 1700000002000,
    }
  );

  const state = translator.getWordCooldownState('optimize', 1700000002000);
  assert.equal(state.inCooldown, true);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].word, 'strategy');

  translator.__resetContextFeedbackForTest();
});

test('buildTokens: 应透传 CEFR 与词频元数据到词 token', () => {
  const tokens = translator.buildTokens('我们优化系统', [
    {
      start: 2,
      end: 4,
      word: 'optimize',
      level: 'CET4',
      meaning: '优化',
      cefrLevel: 'B1',
      cefrRank: 3,
      frequency: 123456,
    },
  ]);

  const wordToken = tokens.find((token) => token.type === 'word');
  assert.ok(wordToken);
  assert.equal(wordToken.cefrLevel, 'B1');
  assert.equal(wordToken.cefrRank, 3);
  assert.equal(wordToken.frequency, 123456);
});

test('buildMixedText: 词替换应使用 单词（原词语意思） 格式', () => {
  const mixed = translator.buildMixedText([
    { type: 'text', text: '我们' },
    { type: 'word', word: 'optimize', sourceText: '优化', meaning: '优化' },
    { type: 'text', text: '系统' },
  ]);

  assert.equal(mixed, '我们optimize（优化）系统');
});
