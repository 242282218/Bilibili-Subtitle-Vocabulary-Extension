# Vocabulary Sources & Licenses

This project builds exam-level vocabulary data from the following upstream sources.

## 1) ECDICT
- Repository: https://github.com/skywind3000/ECDICT
- License: MIT
- Usage in this project:
  - Base English-Chinese entries
  - Exam tags (`cet4`, `cet6`, `ky`, `ielts`, `toefl`)
  - Phonetic and base part-of-speech prefixes

## 2) Words-CEFR-Dataset
- Repository: https://github.com/Maximax67/Words-CEFR-Dataset
- License: MIT
- Usage in this project:
  - Word-level CEFR rank mapping (`A1` to `C2`)
  - Frequency signals for selection ranking

## 3) KyleBing / english-vocabulary
- Repository: https://github.com/KyleBing/english-vocabulary
- License: No explicit GitHub license metadata detected at implementation time
- Usage in this project:
  - CET4 / CET6 / 考研词表扩容
  - 中文释义补强
  - Translation `type` fields for part-of-speech backfill
  - 词组 / 短语支持
  - 生成 `coverageTier=core` 的核心高频层

## 4) exam-data / NETEMVocabulary
- Repository: https://github.com/exam-data/NETEMVocabulary
- License: GitHub API reports `NOASSERTION`; verify upstream terms before redistribution
- Usage in this project:
  - 考研词频排序参考
  - `examFrequencyScore` 与 `examPriorityScore` 计算
  - 强化 `KAOYAN.core` 核心高频层

## 5) CC-CEDICT (MDBG distribution)
- Wiki: https://cc-cedict.org/wiki/start
- Download: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- License (MDBG published file): CC BY-SA 3.0
- Usage in this project:
  - Chinese alias supplement for matching coverage

## Build Script
- Script: `bilibili-vocab-extension/scripts/build-vocab-dataset.js`
- Source cache directory: `bilibili-vocab-extension/sources/`
- Generated files: `bilibili-vocab-extension/data/cet4.json`, `cet6.json`, `kaoyan.json`, `ielts.json`, `toefl.json`, `sources.json`
- Exam-focused fields:
  - `partOfSpeech` (derived from ECDICT POS prefixes and KyleBing translation types)
  - `coverageTier`
  - `sourceFlags`
  - `altMeanings`
  - `examFrequencyScore`
  - `examPriorityScore`
  - `isPhraseBacked`
  - `phraseCount`

## Compliance Notes
- Keep this attribution file when redistributing generated data.
- If you distribute data containing CC-CEDICT-derived content, preserve attribution and share-alike obligations.
