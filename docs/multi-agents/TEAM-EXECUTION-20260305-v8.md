# Multi-Agents Execution Log (v4-v8)

## Team
- `A00` Supervisor: Stage routing, gate control, trace management.
- `A03` Logic Engineer: Data pipeline, CEFR strategy, frequency-based ranking.
- `A04` Runtime Engineer: Alias index support, metadata rendering and tooltip integration.
- `A06` QA/SDET: Stage-by-stage regression and fail-fast checks.
- `A11` Docs/KM: Final docs and artifact closure.

## Stage Reports

### v4 - External Dictionary Pipeline
- Scope:
  - Added `scripts/build-vocab-dataset.js`.
  - Integrated ECDICT, Words-CEFR, and CC-CEDICT sources into generated `data/*.json`.
  - Strengthened dataset tests (`count`, `encoding`, `field completeness`).
- Command checks:
  - `node scripts/build-vocab-dataset.js`
  - `node --test tests/*.test.js`
- Result: `10 passed / 0 failed`.

### v5 - CEFR-Aware Selection
- Scope:
  - Added setting `targetCefr` (`A1`~`C2`, default `B2`).
  - Connected setting flow in background/content/popup/options.
  - Updated selection logic to prefer candidates close to target CEFR when level is equal.
- Command checks:
  - `node --test tests/*.test.js`
- Result: `11 passed / 0 failed`.

### v6 - Alias Matching Coverage
- Scope:
  - Added alias extraction and indexing support in `vocabulary.js`.
  - Added pre-sorted Chinese token cache to avoid repeated per-call sorting.
  - Added tests for alias hit and dedup behavior.
- Command checks:
  - `node --test tests/*.test.js`
- Result: `13 passed / 0 failed`.

### v7 - Frequency Prioritization
- Scope:
  - Added frequency tie-breaker in selection sort.
  - Added failing test first, then patch (TDD red-green).
- Red test:
  - `13 passed / 1 failed` (frequency preference case).
- Green test:
  - `14 passed / 0 failed`.

### v8 - Metadata End-to-End UX
- Scope:
  - Propagated `cefrLevel`, `cefrRank`, and `frequency` through `match -> token -> renderer -> tooltip`.
  - Tooltip now displays `Exam level + CEFR + corpus frequency`.
  - Added token metadata propagation test.
- Command checks:
  - `node --test tests/*.test.js`
- Result: `15 passed / 0 failed`.

## Final Validation
- Syntax checks:
  - `node --check translator.js`
  - `node --check vocabulary.js`
  - `node --check contentScript.js`
  - `node --check scripts/build-vocab-dataset.js`
- Final test suite: `15 passed / 0 failed`.