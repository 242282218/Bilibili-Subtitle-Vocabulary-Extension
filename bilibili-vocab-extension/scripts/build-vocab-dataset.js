#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const zlib = require("node:zlib");
const readline = require("node:readline");

const ROOT_DIR = path.resolve(__dirname, "..");
const SOURCES_DIR = path.join(ROOT_DIR, "sources");
const DATA_DIR = path.join(ROOT_DIR, "data");

const SOURCE_FILES = {
  ecdict: {
    file: path.join(SOURCES_DIR, "ecdict.csv"),
    url: "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
  },
  words: {
    file: path.join(SOURCES_DIR, "words.csv"),
    url: "https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/words.csv"
  },
  wordPos: {
    file: path.join(SOURCES_DIR, "word_pos.csv"),
    url: "https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/word_pos.csv"
  },
  cedict: {
    file: path.join(SOURCES_DIR, "cedict_ts.u8.gz"),
    url: "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz"
  }
};

const LEVELS = ["CET4", "CET6", "KAOYAN", "IELTS", "TOEFL"];
const LEVEL_FILE_MAP = {
  CET4: "cet4.json",
  CET6: "cet6.json",
  KAOYAN: "kaoyan.json",
  IELTS: "ielts.json",
  TOEFL: "toefl.json"
};
const CEFR_LABEL_MAP = {
  1: "A1",
  2: "A2",
  3: "B1",
  4: "B2",
  5: "C1",
  6: "C2"
};

const REFRESH = process.argv.includes("--refresh");

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hasChinese(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ""));
}

function normalizeWord(rawWord) {
  const normalized = String(rawWord || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (!/^[a-z][a-z0-9'_-]*$/.test(normalized)) {
    return "";
  }

  return normalized;
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let index = 0;
  let inQuotes = false;

  while (index < line.length) {
    const char = line[index];

    if (inQuotes) {
      if (char === "\"") {
        if (line[index + 1] === "\"") {
          current += "\"";
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

    if (char === "\"") {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      fields.push(current);
      current = "";
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
  return String(meaning || "")
    .split(/[;；,，、/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanMeaningPart(rawPart) {
  return String(rawPart || "")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^[a-zA-Z][a-zA-Z.\s]{0,20}/, "")
    .replace(/^[^\u4e00-\u9fffA-Za-z]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractChineseMeaning(translation) {
  const source = String(translation || "")
    .replace(/\\n/g, "；")
    .replace(/\n/g, "；")
    .trim();
  if (!source || !hasChinese(source)) {
    return "";
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
    return "";
  }

  return unique.slice(0, 4).join("；");
}

function extractLevelsByTag(rawTag) {
  const tagText = String(rawTag || "").toLowerCase();
  const tokens = tagText.split(/[|,;\s]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const levels = [];

  if (tokenSet.has("cet4")) {
    levels.push("CET4");
  }
  if (tokenSet.has("cet6")) {
    levels.push("CET6");
  }
  if (tokenSet.has("ky")) {
    levels.push("KAOYAN");
  }
  if (tokenSet.has("ielts")) {
    levels.push("IELTS");
  }
  if (tokenSet.has("toefl")) {
    levels.push("TOEFL");
  }

  return levels;
}

function rankToCefrLabel(rankValue) {
  return CEFR_LABEL_MAP[rankValue] || "";
}

function readLines(filePath, onLine) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const reader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    reader.on("line", onLine);
    reader.on("close", resolve);
    reader.on("error", reject);
    stream.on("error", reject);
  });
}

function readGzipLines(filePath, onLine) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const unzip = zlib.createGunzip();
    const reader = readline.createInterface({
      input: fileStream.pipe(unzip),
      crlfDelay: Infinity
    });

    reader.on("line", onLine);
    reader.on("close", resolve);
    reader.on("error", reject);
    fileStream.on("error", reject);
    unzip.on("error", reject);
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
          "User-Agent": "Bilibili-Vocab-Builder/1.0"
        }
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
        output.on("finish", () => {
          output.close(resolve);
        });
        output.on("error", reject);
      }
    );

    req.on("error", reject);
  });
}

async function ensureSources() {
  ensureDirectory(SOURCES_DIR);
  const names = Object.keys(SOURCE_FILES);
  for (let index = 0; index < names.length; index += 1) {
    const sourceName = names[index];
    const source = SOURCE_FILES[sourceName];
    const shouldDownload = REFRESH || !fs.existsSync(source.file);
    if (!shouldDownload) {
      continue;
    }

    console.log(`[fetch] ${sourceName} <- ${source.url}`);
    await requestToFile(source.url, source.file);
  }
}

async function buildCefrMap() {
  const wordIdToWord = new Map();
  let isFirstLine = true;

  await readLines(SOURCE_FILES.words.file, (line) => {
    if (!line) {
      return;
    }

    if (isFirstLine) {
      isFirstLine = false;
      return;
    }

    const columns = parseCsvLine(line);
    const wordId = String(columns[0] || "").trim();
    const word = normalizeWord(columns[1]);
    if (!wordId || !word) {
      return;
    }
    wordIdToWord.set(wordId, word);
  });

  const cefrMap = new Map();
  isFirstLine = true;
  await readLines(SOURCE_FILES.wordPos.file, (line) => {
    if (!line) {
      return;
    }

    if (isFirstLine) {
      isFirstLine = false;
      return;
    }

    const columns = parseCsvLine(line);
    const wordId = String(columns[1] || "").trim();
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
        frequency: Number.isFinite(frequency) ? frequency : 0
      });
      return;
    }

    const nextRank = Math.min(existing.cefrRank, levelNumber);
    const nextFrequency = Math.max(existing.frequency, Number.isFinite(frequency) ? frequency : 0);
    cefrMap.set(word, {
      cefrRank: nextRank,
      cefrLevel: rankToCefrLabel(nextRank),
      frequency: nextFrequency
    });
  });

  return cefrMap;
}

function shouldReplaceEntry(existing, candidate) {
  if (!existing) {
    return true;
  }

  if ((candidate.frequency || 0) !== (existing.frequency || 0)) {
    return (candidate.frequency || 0) > (existing.frequency || 0);
  }

  return String(candidate.meaning || "").length > String(existing.meaning || "").length;
}

async function buildExamEntries(cefrMap) {
  const entriesByKey = new Map();
  let isFirstLine = true;

  await readLines(SOURCE_FILES.ecdict.file, (line) => {
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
      cefrLevel: "",
      frequency: 0
    };

    levels.forEach((level) => {
      const candidate = {
        word,
        meaning,
        level,
        phonetic: String(columns[1] || "").trim(),
        partOfSpeech: String(columns[4] || "").trim(),
        definition: String(columns[3] || "").trim(),
        cefrLevel: cefrInfo.cefrLevel,
        cefrRank: cefrInfo.cefrRank || 0,
        frequency: Math.max(Number(columns[9] || 0), cefrInfo.frequency || 0),
        aliases: []
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

async function buildCedictSupplement(selectedWords) {
  const supplementMap = new Map();

  await readGzipLines(SOURCE_FILES.cedict.file, (line) => {
    if (!line || line.startsWith("#")) {
      return;
    }

    const match = line.match(/^(\S+)\s+(\S+)\s+\[[^\]]+\]\s+\/(.+)\/$/);
    if (!match) {
      return;
    }

    const simplified = String(match[2] || "").trim();
    if (!hasChinese(simplified)) {
      return;
    }

    const definitions = String(match[3] || "");
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
      const token = String(alias || "").trim();
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
    entriesByKey.set(key, entry);
  });
}

function sortEntries(entries) {
  return entries.sort((left, right) => {
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
  fs.writeFileSync(filePath, json, { encoding: "utf8" });
}

function groupEntries(entriesByKey) {
  const grouped = {
    CET4: [],
    CET6: [],
    KAOYAN: [],
    IELTS: [],
    TOEFL: []
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
      aliases: entry.aliases
    });
  });

  LEVELS.forEach((level) => {
    grouped[level] = sortEntries(grouped[level]);
  });

  return grouped;
}

function printSummary(grouped) {
  console.log("[summary] Generated entries:");
  LEVELS.forEach((level) => {
    console.log(`  - ${level}: ${grouped[level].length}`);
  });
}

async function main() {
  ensureDirectory(DATA_DIR);
  await ensureSources();

  console.log("[build] loading CEFR map...");
  const cefrMap = await buildCefrMap();

  console.log("[build] loading exam entries from ECDICT...");
  const entriesByKey = await buildExamEntries(cefrMap);
  const selectedWords = new Set(Array.from(entriesByKey.values()).map((entry) => entry.word));

  console.log("[build] loading CEDICT supplement...");
  const cedictSupplement = await buildCedictSupplement(selectedWords);
  mergeCedictAliases(entriesByKey, cedictSupplement);

  const grouped = groupEntries(entriesByKey);
  LEVELS.forEach((level) => {
    const fileName = LEVEL_FILE_MAP[level];
    writeJson(path.join(DATA_DIR, fileName), grouped[level]);
  });

  printSummary(grouped);
  console.log("[done] data files updated in /data");
}

main().catch((error) => {
  console.error("[error]", error);
  process.exitCode = 1;
});
