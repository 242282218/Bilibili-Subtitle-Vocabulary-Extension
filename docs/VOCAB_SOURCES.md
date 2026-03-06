# Vocabulary Sources & Licenses

This project builds exam-level vocabulary data from the following upstream sources.

## 1) ECDICT
- Repository: https://github.com/skywind3000/ECDICT
- License: MIT
- Usage in this project:
  - Base English-Chinese entries
  - Exam tags (`cet4`, `cet6`, `ky`, `ielts`, `toefl`)
  - Phonetic and part-of-speech fields

## 2) Words-CEFR-Dataset
- Repository: https://github.com/Maximax67/Words-CEFR-Dataset
- License: MIT
- Usage in this project:
  - Word-level CEFR rank mapping (`A1` to `C2`)
  - Frequency signals for selection ranking

## 3) CC-CEDICT (MDBG distribution)
- Wiki: https://cc-cedict.org/wiki/start
- Download: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- License (MDBG published file): CC BY-SA 3.0
- Usage in this project:
  - Chinese alias supplement for matching coverage

## Build Script
- Script: `bilibili-vocab-extension/scripts/build-vocab-dataset.js`
- Source cache directory: `bilibili-vocab-extension/sources/`
- Generated files: `bilibili-vocab-extension/data/cet4.json`, `cet6.json`, `kaoyan.json`, `ielts.json`, `toefl.json`

## Compliance Notes
- Keep this attribution file when redistributing generated data.
- If you distribute data containing CC-CEDICT-derived content, preserve attribution and share-alike obligations.