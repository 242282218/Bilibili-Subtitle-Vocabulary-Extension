const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  normalizeReport,
  refreshOverlaySizeBaseline
} = require("../scripts/refresh-overlay-size-baseline.js");

const SCRIPT_PATH = path.resolve(__dirname, "..", "scripts", "refresh-overlay-size-baseline.js");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "overlay-size-baseline-"));
}

test("refresh overlay baseline: should write baseline file from report actualKb", () => {
  const workspace = createTempDir();
  try {
    const reportFile = path.join(workspace, "dist", "overlay-size-report.json");
    const baselineFile = path.join(workspace, "config", "overlay-size-baseline.json");
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(
      reportFile,
      JSON.stringify({
        checkedAt: "2026-04-16T00:00:00.000Z",
        actualKb: {
          raw: 220.234,
          gzip: 57.678
        }
      }),
      "utf8"
    );

    const { baseline } = refreshOverlaySizeBaseline({
      reportFile,
      baselineFile
    });

    assert.deepEqual(baseline, {
      raw: 220.23,
      gzip: 57.68,
      capturedAt: "2026-04-16T00:00:00.000Z",
      source: "dist/overlay-size-report.json"
    });

    const saved = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    assert.deepEqual(saved, baseline);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("refresh overlay baseline: should reject report without actualKb", () => {
  const workspace = createTempDir();
  try {
    const reportFile = path.join(workspace, "dist", "overlay-size-report.json");
    const baselineFile = path.join(workspace, "config", "overlay-size-baseline.json");
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify({}), "utf8");

    assert.throws(
      () =>
        refreshOverlaySizeBaseline({
          reportFile,
          baselineFile
        }),
      /missing actualKb/
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("refresh overlay baseline: normalizeReport should reject non-positive actual sizes", () => {
  assert.throws(
    () =>
      normalizeReport({
        actualKb: {
          raw: 0,
          gzip: 1
        }
      }),
    /actualKb.raw/
  );
});

test("refresh overlay baseline: CLI should exit non-zero when report is missing", () => {
  const workspace = createTempDir();
  try {
    const missingReportFile = path.join(workspace, "dist", "overlay-size-report.json");
    const baselineFile = path.join(workspace, "config", "overlay-size-baseline.json");
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      env: {
        ...process.env,
        OVERLAY_SIZE_REPORT_FILE: missingReportFile,
        OVERLAY_SIZE_BASELINE_FILE: baselineFile
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing .*overlay-size-report\.json/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
