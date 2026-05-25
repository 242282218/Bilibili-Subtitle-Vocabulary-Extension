#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const zlib = require('node:zlib');
const readline = require('node:readline');

const ROOT_DIR = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(ROOT_DIR, 'sources');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const SOURCE_FILES = {
  ecdict: {
    file: path.join(SOURCES_DIR, 'ecdict.csv'),
    url: 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
  },
  words: {
    file: path.join(SOURCES_DIR, 'words.csv'),
    url: 'https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/words.csv',
  },
  wordPos: {
    file: path.join(SOURCES_DIR, 'word_pos.csv'),
    url: 'https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/word_pos.csv',
  },
  cedict: {
    file: path.join(SOURCES_DIR, 'cedict_ts.u8.gz'),
    url: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
  },
  kylebingCet4: {
    file: path.join(SOURCES_DIR, 'kylebing-cet4.json'),
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/json/3-CET4-%E9%A1%BA%E5%BA%8F.json',
  },
  kylebingCet6: {
    file: path.join(SOURCES_DIR, 'kylebing-cet6.json'),
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/json/4-CET6-%E9%A1%BA%E5%BA%8F.json',
  },
  kylebingKaoyan: {
    file: path.join(SOURCES_DIR, 'kylebing-kaoyan.json'),
    url: 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/json/5-%E8%80%83%E7%A0%94-%E9%A1%BA%E5%BA%8F.json',
  },
  netem: {
    file: path.join(SOURCES_DIR, 'netem_full_list.json'),
    url: 'https://raw.githubusercontent.com/exam-data/NETEMVocabulary/master/netem_full_list.json',
  },
};
const SOURCE_MANIFEST_DATE = '2026-04-16';
const SOURCE_MANIFEST = [
  {
    name: 'ECDICT',
    url: 'https://github.com/skywind3000/ECDICT',
    license: 'MIT',
    licenseStatus: 'verified',
    redistributable: true,
    attributionRequired: true,
    shareAlikeRequired: false,
    publishBlocking: false,
    reviewAction: '',
    sourceIds: ['ecdict'],
    notes: '英汉词典，含 cet4/cet6/ielts/toefl/ky 标签。',
  },
  {
    name: 'Words-CEFR-Dataset',
    url: 'https://github.com/Maximax67/Words-CEFR-Dataset',
    license: 'MIT',
    licenseStatus: 'verified',
    redistributable: true,
    attributionRequired: true,
    shareAlikeRequired: false,
    publishBlocking: false,
    reviewAction: '',
    sourceIds: ['words', 'wordPos'],
    notes: '按词与词性提供 CEFR 数值等级 (1-6)。',
  },
  {
    name: 'KyleBing/english-vocabulary',
    url: 'https://github.com/KyleBing/english-vocabulary',
    license: 'No explicit GitHub license metadata detected',
    licenseStatus: 'needs-review',
    redistributable: false,
    attributionRequired: true,
    shareAlikeRequired: false,
    publishBlocking: true,
    reviewAction:
      'Obtain explicit redistribution permission or remove derived entries before publishing.',
    sourceIds: ['kylebingCet4', 'kylebingCet6', 'kylebingKaoyan'],
    notes: '提供 CET4 / CET6 / 考研词表、中文释义与短语，用于构建 core 高频层。',
  },
  {
    name: 'exam-data/NETEMVocabulary',
    url: 'https://github.com/exam-data/NETEMVocabulary',
    license: 'NOASSERTION (GitHub API)',
    licenseStatus: 'needs-review',
    redistributable: false,
    attributionRequired: true,
    shareAlikeRequired: false,
    publishBlocking: true,
    reviewAction:
      'Verify upstream redistribution terms or remove NETEM-derived ranking fields before publishing.',
    sourceIds: ['netem'],
    notes: '提供考研词频排序，用于构建 KAOYAN 的 examFrequencyScore 与 examPriorityScore。',
  },
  {
    name: 'CC-CEDICT',
    url: 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
    license: 'CC BY-SA 3.0 (MDBG 发布版本)',
    licenseStatus: 'verified',
    redistributable: true,
    attributionRequired: true,
    shareAlikeRequired: true,
    publishBlocking: false,
    reviewAction:
      'Preserve attribution and share-alike obligations when redistributing derived data.',
    sourceIds: ['cedict'],
    notes: '用于中文释义补充，需保留署名与同协议要求。',
  },
];
const POS_TOKEN_MAP = Object.freeze({
  a: 'adj',
  adjective: 'adj',
  adj: 'adj',
  ad: 'adv',
  adverb: 'adv',
  adv: 'adv',
  article: 'art',
  art: 'art',
  auxiliary: 'aux',
  aux: 'aux',
  abbreviation: 'abbr',
  abbr: 'abbr',
  conjunction: 'conj',
  conj: 'conj',
  interjection: 'int',
  int: 'int',
  noun: 'n',
  n: 'n',
  numeral: 'num',
  num: 'num',
  plural: 'pl',
  pl: 'pl',
  preposition: 'prep',
  prep: 'prep',
  pronoun: 'pron',
  pron: 'pron',
  verb: 'v',
  v: 'v',
  vi: 'vi',
  vt: 'vt',
});
const POS_OUTPUT_ORDER = [
  'n',
  'v',
  'vt',
  'vi',
  'adj',
  'adv',
  'prep',
  'pron',
  'num',
  'conj',
  'int',
  'aux',
  'abbr',
  'art',
  'pl',
];
const MANIFEST_FILE_NAME = 'sources.json';

const LEVELS = ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'];
const EXAM_LEVELS = new Set(['CET4', 'CET6', 'KAOYAN']);
const BUILD_TARGETS = new Set(['development', 'publish']);
const LEVEL_FILE_MAP = {
  CET4: 'cet4.json',
  CET6: 'cet6.json',
  KAOYAN: 'kaoyan.json',
  IELTS: 'ielts.json',
  TOEFL: 'toefl.json',
};
const CEFR_LABEL_MAP = {
  1: 'A1',
  2: 'A2',
  3: 'B1',
  4: 'B2',
  5: 'C1',
  6: 'C2',
};

const PUBLISH_BLOCKING_SOURCE_FLAGS = ['kylebing', 'netem'];

function normalizeBuildTarget(rawValue = 'development') {
  const normalized = String(rawValue || 'development')
    .trim()
    .toLowerCase();
  if (!BUILD_TARGETS.has(normalized)) {
    throw new Error(`Unsupported build target: ${rawValue}`);
  }
  return normalized;
}

function readRequiredCliValue(optionName, value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.startsWith('--')) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return normalized;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed = {
    refresh: false,
    buildTarget: 'development',
    outputDir: DATA_DIR,
  };
  let rawBuildTarget = '';
  let publishSafe = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--refresh') {
      parsed.refresh = true;
      continue;
    }

    if (arg === '--publish-safe') {
      publishSafe = true;
      continue;
    }

    if (arg === '--build-target') {
      rawBuildTarget = readRequiredCliValue('--build-target', argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith('--build-target=')) {
      rawBuildTarget = readRequiredCliValue('--build-target', arg.slice('--build-target='.length));
      continue;
    }

    if (arg === '--output-dir') {
      parsed.outputDir = readRequiredCliValue('--output-dir', argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith('--output-dir=')) {
      parsed.outputDir = readRequiredCliValue('--output-dir', arg.slice('--output-dir='.length));
      continue;
    }

    throw new Error(`Unknown vocabulary dataset option: ${arg}`);
  }

  parsed.buildTarget = normalizeBuildTarget(
    publishSafe ? 'publish' : rawBuildTarget || 'development'
  );
  return parsed;
}

function shouldIncludePublishBlockingSources(buildTarget = 'development') {
  return normalizeBuildTarget(buildTarget) !== 'publish';
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hasChinese(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

function normalizeWord(rawWord) {
  const normalized = String(rawWord || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return '';
  }

  if (!/^[a-z][a-z0-9'_-]*$/.test(normalized)) {
    return '';
  }

  return normalized;
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let index = 0;
  let inQuotes = false;

  while (index < line.length) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }

      current += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ',') {
      fields.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  fields.push(current);
  return fields;
}

function splitMeaningParts(meaning) {
  return String(meaning || '')
    .split(/[;；,，、/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanMeaningPart(rawPart) {
  return String(rawPart || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^[a-zA-Z][a-zA-Z.\s]{0,20}/, '')
    .replace(/^[^\u4e00-\u9fffA-Za-z]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractChineseMeaning(translation) {
  const source = String(translation || '')
    .replace(/\\n/g, '；')
    .replace(/\n/g, '；')
    .trim();
  if (!source || !hasChinese(source)) {
    return '';
  }

  const unique = [];
  splitMeaningParts(source).forEach((part) => {
    const cleaned = cleanMeaningPart(part);
    if (!cleaned || !hasChinese(cleaned) || unique.includes(cleaned)) {
      return;
    }
    unique.push(cleaned);
  });

  if (unique.length === 0) {
    return '';
  }

  return unique.slice(0, 4).join('；');
}

function extractLevelsByTag(rawTag) {
  const tagText = String(rawTag || '').toLowerCase();
  const tokens = tagText.split(/[|,;\s]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const levels = [];

  if (tokenSet.has('cet4')) {
    levels.push('CET4');
  }
  if (tokenSet.has('cet6')) {
    levels.push('CET6');
  }
  if (tokenSet.has('ky')) {
    levels.push('KAOYAN');
  }
  if (tokenSet.has('ielts')) {
    levels.push('IELTS');
  }
  if (tokenSet.has('toefl')) {
    levels.push('TOEFL');
  }

  return levels;
}

function rankToCefrLabel(rankValue) {
  const numericRank = Number(rankValue);
  if (!Number.isFinite(numericRank) || numericRank < 1 || numericRank > 6) {
    return '';
  }

  const normalizedRank = Math.max(1, Math.min(6, Math.round(numericRank)));
  return CEFR_LABEL_MAP[normalizedRank] || '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function splitDefinitionParts(value) {
  return String(value || '')
    .split(/[;；/]/)
    .map((part) => cleanMeaningPart(part))
    .filter((part) => Boolean(part));
}

function uniq(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function hasPublishBlockingFlag(sourceFlags) {
  return uniq(sourceFlags).some((flag) => PUBLISH_BLOCKING_SOURCE_FLAGS.includes(flag));
}

function normalizePosToken(rawToken) {
  const normalized = String(rawToken || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/g, '');
  return POS_TOKEN_MAP[normalized] || '';
}

function normalizePosTokens(tokens) {
  const normalized = uniq(tokens.map((token) => normalizePosToken(token)));
  if (normalized.includes('v') && (normalized.includes('vt') || normalized.includes('vi'))) {
    return normalized.filter((token) => token !== 'v');
  }
  return normalized.sort((left, right) => {
    const leftIndex = POS_OUTPUT_ORDER.indexOf(left);
    const rightIndex = POS_OUTPUT_ORDER.indexOf(right);
    if (leftIndex === -1 || rightIndex === -1) {
      return left.localeCompare(right);
    }
    return leftIndex - rightIndex;
  });
}

function formatPartOfSpeech(tokens) {
  return normalizePosTokens(tokens).join(' / ');
}

function trimLeadingLexicalNotes(value) {
  let nextValue = String(value || '').trim();
  let previousValue = '';
  while (nextValue && nextValue !== previousValue) {
    previousValue = nextValue;
    nextValue = nextValue
      .replace(/^\[[^\]]+\]\s*/u, '')
      .replace(/^\([^)]*\)\s*/u, '')
      .replace(/^（[^）]*）\s*/u, '');
  }
  return nextValue;
}

function parsePosTagString(rawValue) {
  const cleaned = trimLeadingLexicalNotes(rawValue).replace(/[+]/g, '&');
  if (!cleaned) {
    return [];
  }
  const rawTokens = cleaned.match(/[A-Za-z]{1,16}/g) || [];
  return normalizePosTokens(rawTokens);
}

function extractLeadingPosTokens(rawSection) {
  let remaining = trimLeadingLexicalNotes(rawSection);
  const tokens = [];

  while (remaining) {
    const tokenMatch = remaining.match(/^([A-Za-z]{1,16})/);
    if (!tokenMatch) {
      break;
    }

    const token = normalizePosToken(tokenMatch[1]);
    if (!token) {
      break;
    }

    const suffix = remaining[tokenMatch[1].length] || '';
    if (
      suffix &&
      suffix !== '.' &&
      suffix !== '&' &&
      suffix !== '/' &&
      suffix !== ',' &&
      !/\s/.test(suffix)
    ) {
      break;
    }

    tokens.push(token);
    remaining = remaining.slice(tokenMatch[1].length).replace(/^\./, '').trimStart();
    if (!remaining) {
      break;
    }

    const nextValue = remaining.replace(/^[&/,;；]+/, '').trimStart();
    if (nextValue === remaining && !/^[A-Za-z]/.test(nextValue)) {
      break;
    }
    remaining = nextValue;
  }

  return normalizePosTokens(tokens);
}

function extractDefinitionPosTokens(rawValue) {
  const sections = String(rawValue || '')
    .replace(/\\n/g, '\n')
    .split(/[\n;；]+/);
  const tokens = [];

  sections.forEach((section) => {
    tokens.push(...extractLeadingPosTokens(section));
  });

  return normalizePosTokens(tokens);
}

function mergePartOfSpeechValues(...values) {
  const tokens = [];
  values.forEach((value) => {
    if (!value) {
      return;
    }
    tokens.push(...parsePosTagString(String(value).replace(/\s*\/\s*/g, '&')));
  });
  return formatPartOfSpeech(tokens);
}

function getEntryPartOfSpeech(rawPosField, rawDefinition) {
  const tokens = [...parsePosTagString(rawPosField), ...extractDefinitionPosTokens(rawDefinition)];
  return formatPartOfSpeech(tokens);
}

function toSourceRelativePath(filePath) {
  return path.posix.join('sources', path.basename(filePath));
}

function createSourceManifest(sourceFiles = SOURCE_FILES) {
  return {
    generatedAt: SOURCE_MANIFEST_DATE,
    sources: SOURCE_MANIFEST.map((source) => ({
      name: source.name,
      url: source.url,
      license: source.license,
      licenseStatus: source.licenseStatus,
      redistributable: source.redistributable,
      attributionRequired: source.attributionRequired,
      shareAlikeRequired: source.shareAlikeRequired,
      publishBlocking: source.publishBlocking,
      reviewAction: source.reviewAction,
      files: source.sourceIds.map((sourceId) => toSourceRelativePath(sourceFiles[sourceId].file)),
      notes: source.notes,
    })),
  };
}

function hasCuratedExamSignal(sourceFlags) {
  return uniq(sourceFlags).some((flag) => flag === 'kylebing' || flag === 'netem');
}

function deriveCoverageTier(level, sourceFlags) {
  if (!EXAM_LEVELS.has(level)) {
    return 'full';
  }

  return hasCuratedExamSignal(sourceFlags) ? 'core' : 'full';
}

function deriveExamPriorityScore(sourceFlags, phraseCount) {
  const normalizedFlags = uniq(sourceFlags);
  const normalizedPhraseCount = Math.max(0, Number(phraseCount) || 0);

  return (
    (normalizedFlags.includes('ecdict') ? 10 : 0) +
    (normalizedFlags.includes('kylebing') ? 35 : 0) +
    (normalizedFlags.includes('netem') ? 25 : 0) +
    Math.min(20, normalizedPhraseCount * 2)
  );
}

function readLines(filePath, onLine) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const reader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    reader.on('line', onLine);
    reader.on('close', resolve);
    reader.on('error', reject);
    stream.on('error', reject);
  });
}

function readGzipLines(filePath, onLine) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const unzip = zlib.createGunzip();
    const reader = readline.createInterface({
      input: fileStream.pipe(unzip),
      crlfDelay: Infinity,
    });

    reader.on('line', onLine);
    reader.on('close', resolve);
    reader.on('error', reject);
    fileStream.on('error', reject);
    unzip.on('error', reject);
  });
}

function requestToFile(url, destination, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }

    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Bilibili-Vocab-Builder/1.0',
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          requestToFile(res.headers.location, destination, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${url} status=${res.statusCode}`));
          res.resume();
          return;
        }

        const output = fs.createWriteStream(destination);
        res.pipe(output);
        output.on('finish', () => {
          output.close(resolve);
        });
        output.on('error', reject);
      }
    );

    req.on('error', reject);
  });
}

async function ensureSources(sourceFiles = SOURCE_FILES, options = {}) {
  ensureDirectory(SOURCES_DIR);
  const names = Object.keys(sourceFiles);
  for (let index = 0; index < names.length; index += 1) {
    const sourceName = names[index];
    const source = sourceFiles[sourceName];
    const shouldDownload = options.refresh === true || !fs.existsSync(source.file);
    if (!shouldDownload) {
      continue;
    }

    console.log(`[fetch] ${sourceName} <- ${source.url}`);
    await requestToFile(source.url, source.file);
  }
}

async function buildCefrMap(sourceFiles = SOURCE_FILES) {
  const wordIdToWord = new Map();
  let isFirstLine = true;

  await readLines(sourceFiles.words.file, (line) => {
    if (!line) {
      return;
    }

    if (isFirstLine) {
      isFirstLine = false;
      return;
    }

    const columns = parseCsvLine(line);
    const wordId = String(columns[0] || '').trim();
    const word = normalizeWord(columns[1]);
    if (!wordId || !word) {
      return;
    }
    wordIdToWord.set(wordId, word);
  });

  const cefrMap = new Map();
  isFirstLine = true;
  await readLines(sourceFiles.wordPos.file, (line) => {
    if (!line) {
      return;
    }

    if (isFirstLine) {
      isFirstLine = false;
      return;
    }

    const columns = parseCsvLine(line);
    const wordId = String(columns[1] || '').trim();
    const levelNumber = Number(columns[5] || 0);
    const frequency = Number(columns[4] || 0);
    if (!wordId || !Number.isFinite(levelNumber) || levelNumber < 1 || levelNumber > 6) {
      return;
    }

    const word = wordIdToWord.get(wordId);
    if (!word) {
      return;
    }

    const existing = cefrMap.get(word);
    if (!existing) {
      cefrMap.set(word, {
        cefrRank: levelNumber,
        cefrLevel: rankToCefrLabel(levelNumber),
        frequency: Number.isFinite(frequency) ? frequency : 0,
      });
      return;
    }

    const nextRank = Math.min(existing.cefrRank, levelNumber);
    const nextFrequency = Math.max(existing.frequency, Number.isFinite(frequency) ? frequency : 0);
    cefrMap.set(word, {
      cefrRank: nextRank,
      cefrLevel: rankToCefrLabel(nextRank),
      frequency: nextFrequency,
    });
  });

  return cefrMap;
}

function mapKyleBingLevelFile(level, filePath) {
  const raw = readJson(filePath);
  const records = Array.isArray(raw) ? raw : [];
  const mapped = new Map();
  const total = records.length || 1;

  records.forEach((item, index) => {
    const word = normalizeWord(item.word);
    if (!word) {
      return;
    }

    const translations = Array.isArray(item.translations) ? item.translations : [];
    const translationTexts = uniq(
      translations
        .map((translation) => extractChineseMeaning(translation.translation))
        .filter(Boolean)
    );
    const phraseItems = Array.isArray(item.phrases) ? item.phrases : [];
    const phraseTexts = uniq(
      phraseItems
        .map((phrase) => extractChineseMeaning(phrase.translation))
        .flatMap((meaning) => splitDefinitionParts(meaning))
    );
    const partOfSpeech = formatPartOfSpeech(
      translations.flatMap((translation) => parsePosTagString(translation.type))
    );
    const allMeanings = uniq([...translationTexts, ...phraseTexts]);
    const primaryMeaning = allMeanings[0] || '';

    mapped.set(word, {
      level,
      word,
      meaning: primaryMeaning,
      partOfSpeech,
      altMeanings: allMeanings.slice(1, 6),
      phraseCount: phraseItems.length,
      isPhraseBacked: phraseItems.length > 0,
      examFrequencyScore: Math.max(0, total - index),
      sourceFlags: ['kylebing'],
    });
  });

  return mapped;
}

function buildKyleBingMaps(sourceFiles = SOURCE_FILES) {
  return {
    CET4: mapKyleBingLevelFile('CET4', sourceFiles.kylebingCet4.file),
    CET6: mapKyleBingLevelFile('CET6', sourceFiles.kylebingCet6.file),
    KAOYAN: mapKyleBingLevelFile('KAOYAN', sourceFiles.kylebingKaoyan.file),
  };
}

function buildNetemMap(sourceFiles = SOURCE_FILES) {
  const payload = readJson(sourceFiles.netem.file);
  const rows = Array.isArray(payload['5530考研词汇词频排序表'])
    ? payload['5530考研词汇词频排序表']
    : [];
  const mapped = new Map();
  const total = rows.length || 1;

  rows.forEach((row, index) => {
    const word = normalizeWord(row['单词']);
    if (!word) {
      return;
    }

    const meaning = extractChineseMeaning(row['释义']);
    const aliases = uniq(
      splitDefinitionParts(row['其他拼写']).filter((item) => /[\u4e00-\u9fff]/.test(item))
    );
    mapped.set(word, {
      word,
      meaning,
      aliases,
      rank: Number(row['序号']) || index + 1,
      rawFrequency: Number(row['词频']) || 0,
      examFrequencyScore: Math.max(0, total - index),
      sourceFlags: ['netem'],
    });
  });

  return mapped;
}

function shouldReplaceEntry(existing, candidate) {
  if (!existing) {
    return true;
  }

  if ((candidate.frequency || 0) !== (existing.frequency || 0)) {
    return (candidate.frequency || 0) > (existing.frequency || 0);
  }

  return String(candidate.meaning || '').length > String(existing.meaning || '').length;
}

async function buildExamEntries(cefrMap, sourceFiles = SOURCE_FILES) {
  const entriesByKey = new Map();
  let isFirstLine = true;

  await readLines(sourceFiles.ecdict.file, (line) => {
    if (!line) {
      return;
    }

    if (isFirstLine) {
      isFirstLine = false;
      return;
    }

    const columns = parseCsvLine(line);
    const word = normalizeWord(columns[0]);
    const levels = extractLevelsByTag(columns[7]);
    if (!word || levels.length === 0) {
      return;
    }

    const meaning = extractChineseMeaning(columns[3]);
    if (!meaning) {
      return;
    }

    const cefrInfo = cefrMap.get(word) || {
      cefrRank: 0,
      cefrLevel: '',
      frequency: 0,
    };

    levels.forEach((level) => {
      const candidate = {
        word,
        meaning,
        level,
        phonetic: String(columns[1] || '').trim(),
        partOfSpeech: getEntryPartOfSpeech(columns[4], columns[3]),
        definition: String(columns[3] || '').trim(),
        cefrLevel: cefrInfo.cefrLevel,
        cefrRank: cefrInfo.cefrRank || 0,
        frequency: Math.max(Number(columns[9] || 0), cefrInfo.frequency || 0),
        aliases: [],
        altMeanings: [],
        coverageTier: deriveCoverageTier(level, ['ecdict']),
        sourceFlags: ['ecdict'],
        examFrequencyScore: 0,
        examPriorityScore: deriveExamPriorityScore(['ecdict'], 0),
        isPhraseBacked: false,
        phraseCount: 0,
      };

      const key = `${level}|${word}`;
      const existing = entriesByKey.get(key);
      if (shouldReplaceEntry(existing, candidate)) {
        entriesByKey.set(key, candidate);
      }
    });
  });

  return entriesByKey;
}

async function buildCedictSupplement(selectedWords, sourceFiles = SOURCE_FILES) {
  const supplementMap = new Map();

  await readGzipLines(sourceFiles.cedict.file, (line) => {
    if (!line || line.startsWith('#')) {
      return;
    }

    const match = line.match(/^(\S+)\s+(\S+)\s+\[[^\]]+\]\s+\/(.+)\/$/);
    if (!match) {
      return;
    }

    const simplified = String(match[2] || '').trim();
    if (!hasChinese(simplified)) {
      return;
    }

    const definitions = String(match[3] || '');
    const tokens = definitions.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = normalizeWord(tokens[index]);
      if (!token || !selectedWords.has(token)) {
        continue;
      }

      if (!supplementMap.has(token)) {
        supplementMap.set(token, new Set());
      }

      const bucket = supplementMap.get(token);
      if (bucket.size >= 8) {
        continue;
      }
      bucket.add(simplified);
    }
  });

  return supplementMap;
}

function mergeCedictAliases(entriesByKey, cedictSupplement) {
  entriesByKey.forEach((entry, key) => {
    const aliases = cedictSupplement.get(entry.word);
    if (!aliases || aliases.size === 0) {
      return;
    }

    const mergedAliases = [];

    Array.from(aliases).forEach((alias) => {
      const token = String(alias || '').trim();
      if (!token) {
        return;
      }
      if (token.length < 2 || token.length > 6) {
        return;
      }
      if (/[，。,.;；、:：()（）]/.test(token)) {
        return;
      }
      if (!hasChinese(token)) {
        return;
      }
      if (mergedAliases.includes(token)) {
        return;
      }
      mergedAliases.push(token);
    });

    entry.aliases = mergedAliases.slice(0, 5);
    if (entry.aliases.length > 0 && !entry.sourceFlags.includes('cedict')) {
      entry.sourceFlags.push('cedict');
    }
    entriesByKey.set(key, entry);
  });
}

function mergeExamSourceFields(entry, supplement, level) {
  if (!supplement) {
    return entry;
  }

  const sourceFlags = uniq([...(entry.sourceFlags || []), ...(supplement.sourceFlags || [])]);
  const combinedMeanings = uniq([
    entry.meaning,
    ...(entry.altMeanings || []),
    supplement.meaning,
    ...(supplement.altMeanings || []),
  ]);
  const primaryMeaning = combinedMeanings[0] || entry.meaning;
  const altMeanings = combinedMeanings.slice(1, 6);
  const nextAliases = uniq([...(entry.aliases || []), ...(supplement.aliases || [])]).slice(0, 5);
  const nextPhraseCount = Math.max(entry.phraseCount || 0, supplement.phraseCount || 0);
  const nextExamFrequency = Math.max(
    entry.examFrequencyScore || 0,
    supplement.examFrequencyScore || 0
  );
  const nextPartOfSpeech = mergePartOfSpeechValues(entry.partOfSpeech, supplement.partOfSpeech);

  return {
    ...entry,
    meaning: primaryMeaning,
    translation: primaryMeaning,
    partOfSpeech: nextPartOfSpeech,
    altMeanings,
    aliases: nextAliases,
    sourceFlags,
    phraseCount: nextPhraseCount,
    isPhraseBacked: entry.isPhraseBacked === true || supplement.isPhraseBacked === true,
    examFrequencyScore: nextExamFrequency,
    examPriorityScore: deriveExamPriorityScore(sourceFlags, nextPhraseCount),
    coverageTier: deriveCoverageTier(level, sourceFlags),
  };
}

function mergeExamSources(entriesByKey, kylebingMaps, netemMap, cefrMap, options = {}) {
  const includePublishBlockingSources = options.includePublishBlockingSources !== false;

  entriesByKey.forEach((entry, key) => {
    let nextEntry = { ...entry };
    const kylebingEntry =
      includePublishBlockingSources && ['CET4', 'CET6', 'KAOYAN'].includes(entry.level)
        ? kylebingMaps[entry.level].get(entry.word)
        : null;
    nextEntry = mergeExamSourceFields(nextEntry, kylebingEntry, entry.level);

    if (includePublishBlockingSources && entry.level === 'KAOYAN') {
      const netemEntry = netemMap.get(entry.word);
      nextEntry = mergeExamSourceFields(nextEntry, netemEntry, entry.level);
    }

    entriesByKey.set(key, nextEntry);
  });

  ['CET4', 'CET6', 'KAOYAN'].forEach((level) => {
    if (!includePublishBlockingSources) {
      return;
    }

    kylebingMaps[level].forEach((supplement, word) => {
      const key = `${level}|${word}`;
      if (entriesByKey.has(key)) {
        return;
      }

      const cefrInfo = cefrMap.get(word) || {
        cefrRank: 0,
        cefrLevel: '',
        frequency: 0,
      };
      const sourceFlags = supplement.sourceFlags.slice();
      entriesByKey.set(key, {
        word,
        meaning: supplement.meaning,
        level,
        phonetic: '',
        partOfSpeech: supplement.partOfSpeech || '',
        definition: supplement.meaning,
        cefrLevel: cefrInfo.cefrLevel,
        cefrRank: cefrInfo.cefrRank || 0,
        frequency: cefrInfo.frequency || 0,
        aliases: [],
        altMeanings: supplement.altMeanings || [],
        coverageTier: deriveCoverageTier(level, sourceFlags),
        sourceFlags,
        examFrequencyScore: supplement.examFrequencyScore || 0,
        examPriorityScore: deriveExamPriorityScore(sourceFlags, supplement.phraseCount || 0),
        isPhraseBacked: supplement.isPhraseBacked === true,
        phraseCount: supplement.phraseCount || 0,
      });
    });
  });
}

function propagateSharedPartOfSpeech(entriesByKey) {
  const partOfSpeechByWord = new Map();

  entriesByKey.forEach((entry) => {
    if (!entry.partOfSpeech) {
      return;
    }
    partOfSpeechByWord.set(
      entry.word,
      mergePartOfSpeechValues(partOfSpeechByWord.get(entry.word), entry.partOfSpeech)
    );
  });

  entriesByKey.forEach((entry, key) => {
    if (entry.partOfSpeech) {
      return;
    }

    const inheritedPartOfSpeech = partOfSpeechByWord.get(entry.word);
    if (!inheritedPartOfSpeech) {
      return;
    }

    entriesByKey.set(key, {
      ...entry,
      partOfSpeech: inheritedPartOfSpeech,
    });
  });
}

function sortEntries(entries) {
  return entries.sort((left, right) => {
    if ((left.coverageTier || 'full') !== (right.coverageTier || 'full')) {
      return (left.coverageTier || 'full') === 'core' ? -1 : 1;
    }
    if ((right.examPriorityScore || 0) !== (left.examPriorityScore || 0)) {
      return (right.examPriorityScore || 0) - (left.examPriorityScore || 0);
    }
    if ((right.examFrequencyScore || 0) !== (left.examFrequencyScore || 0)) {
      return (right.examFrequencyScore || 0) - (left.examFrequencyScore || 0);
    }
    if ((right.frequency || 0) !== (left.frequency || 0)) {
      return (right.frequency || 0) - (left.frequency || 0);
    }
    if ((left.cefrRank || 0) !== (right.cefrRank || 0)) {
      const leftRank = left.cefrRank || 99;
      const rightRank = right.cefrRank || 99;
      return leftRank - rightRank;
    }
    return left.word.localeCompare(right.word);
  });
}

function writeJson(filePath, payload) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(filePath, json, { encoding: 'utf8' });
}

function groupEntries(entriesByKey) {
  const grouped = {
    CET4: [],
    CET6: [],
    KAOYAN: [],
    IELTS: [],
    TOEFL: [],
  };

  entriesByKey.forEach((entry) => {
    grouped[entry.level].push({
      word: entry.word,
      meaning: entry.meaning,
      level: entry.level,
      phonetic: entry.phonetic,
      partOfSpeech: entry.partOfSpeech,
      definition: entry.definition,
      cefrLevel: entry.cefrLevel,
      cefrRank: entry.cefrRank,
      frequency: entry.frequency,
      aliases: entry.aliases,
      coverageTier: entry.coverageTier,
      sourceFlags: entry.sourceFlags,
      altMeanings: entry.altMeanings,
      examFrequencyScore: entry.examFrequencyScore,
      examPriorityScore: entry.examPriorityScore,
      isPhraseBacked: entry.isPhraseBacked,
      phraseCount: entry.phraseCount,
    });
  });

  LEVELS.forEach((level) => {
    grouped[level] = sortEntries(grouped[level]);
  });

  return grouped;
}

function printSummary(grouped) {
  console.log('[summary] Generated entries:');
  LEVELS.forEach((level) => {
    const coreCount = grouped[level].filter((entry) => entry.coverageTier === 'core').length;
    console.log(`  - ${level}: ${grouped[level].length} (core=${coreCount})`);
  });
}

function writeDatasetFiles(dataDir, grouped, manifest) {
  ensureDirectory(dataDir);
  LEVELS.forEach((level) => {
    const fileName = LEVEL_FILE_MAP[level];
    writeJson(path.join(dataDir, fileName), grouped[level]);
  });
  writeJson(path.join(dataDir, MANIFEST_FILE_NAME), manifest);
}

function listPublishedDataFileNames() {
  return [...LEVELS.map((level) => LEVEL_FILE_MAP[level]), MANIFEST_FILE_NAME];
}

async function buildVocabularyDataset(options = {}) {
  const sourceFiles = options.sourceFiles || SOURCE_FILES;
  const dataDir = options.dataDir || DATA_DIR;
  const shouldEnsureSources = options.ensureSources !== false;
  const buildTarget = normalizeBuildTarget(options.buildTarget || 'development');
  const refresh = options.refresh === true;
  const includePublishBlockingSources = shouldIncludePublishBlockingSources(buildTarget);

  if (shouldEnsureSources) {
    await ensureSources(sourceFiles, { refresh });
  }

  const cefrMap = await buildCefrMap(sourceFiles);
  const entriesByKey = await buildExamEntries(cefrMap, sourceFiles);
  const kylebingMaps = buildKyleBingMaps(sourceFiles);
  const netemMap = buildNetemMap(sourceFiles);
  mergeExamSources(entriesByKey, kylebingMaps, netemMap, cefrMap, {
    includePublishBlockingSources,
  });

  const selectedWords = new Set(Array.from(entriesByKey.values()).map((entry) => entry.word));
  const cedictSupplement = await buildCedictSupplement(selectedWords, sourceFiles);
  mergeCedictAliases(entriesByKey, cedictSupplement);
  propagateSharedPartOfSpeech(entriesByKey);

  const grouped = groupEntries(entriesByKey);
  const manifest = createSourceManifest(sourceFiles);

  if (options.writeFiles !== false) {
    writeDatasetFiles(dataDir, grouped, manifest);
  }

  return {
    buildTarget,
    grouped,
    manifest,
  };
}

async function main() {
  const { buildTarget, outputDir, refresh } = parseCliArgs();
  console.log('[build] loading vocabulary sources...');
  const { grouped } = await buildVocabularyDataset({
    buildTarget,
    dataDir: outputDir,
    refresh,
  });
  printSummary(grouped);
  console.log(`[done] data files updated in ${outputDir} (target=${buildTarget})`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[error]', error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildVocabularyDataset,
  createSourceManifest,
  hasPublishBlockingFlag,
  listPublishedDataFileNames,
  normalizeBuildTarget,
  parseCliArgs,
  shouldIncludePublishBlockingSources,
};
