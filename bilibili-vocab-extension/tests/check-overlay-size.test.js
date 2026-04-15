const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  runOverlaySizeCheck,
  createReport
} = require("../scripts/check-overlay-size.js");

const SCRIPT_PATH = path.resolve(__dirname, "..", "scripts", "check-overlay-size.js");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "overlay-size-check-"));
}

function writeOverlayFile(baseDir, filename, sizeInBytes) {
  const target = path.join(baseDir, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.alloc(sizeInBytes, "a"));
  return target;
}

test("check overlay size: should write report and summary when bundle is within budget", () => {
  const workspace = createTempDir();
  try {
    const overlayFile = writeOverlayFile(workspace, "bundle/overlay.js", 4096);
    const reportFile = path.join(workspace, "reports", "overlay-size-report.json");
    const summaryFile = path.join(workspace, "summary.md");
    const baselineFile = path.join(workspace, "baseline.json");
    fs.writeFileSync(
      baselineFile,
      JSON.stringify({
        raw: 3.5,
        gzip: 0.01
      }),
      "utf8"
    );

    const { report } = runOverlaySizeCheck({
      overlayFile,
      reportFile,
      summaryPath: summaryFile,
      baselineFile,
      rawBudgetKb: 10,
      gzipBudgetKb: 10
    });

    assert.equal(report.result.overall, "pass");
    assert.deepEqual(report.baselineKb, { raw: 3.5, gzip: 0.01 });
    assert.equal(typeof report.deltaKb.raw, "number");
    assert.equal(typeof report.deltaKb.gzip, "number");
    assert.ok(fs.existsSync(reportFile));
    assert.ok(fs.existsSync(summaryFile));

    const parsedReport = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    assert.equal(parsedReport.result.overall, "pass");
    assert.deepEqual(parsedReport.baselineKb, { raw: 3.5, gzip: 0.01 });
    assert.match(fs.readFileSync(summaryFile, "utf8"), /Overall: PASS/);
    assert.match(fs.readFileSync(summaryFile, "utf8"), /Baseline/);
    assert.match(fs.readFileSync(summaryFile, "utf8"), /Delta/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("check overlay size: should mark report as fail when budget is exceeded without baseline", () => {
  const workspace = createTempDir();
  try {
    const overlayFile = writeOverlayFile(workspace, "bundle/overlay.js", 4096);
    const reportFile = path.join(workspace, "reports", "overlay-size-report.json");
    const missingBaselineFile = path.join(workspace, "not-exists-baseline.json");

    const { report } = runOverlaySizeCheck({
      overlayFile,
      reportFile,
      baselineFile: missingBaselineFile,
      rawBudgetKb: 1,
      gzipBudgetKb: 10
    });

    assert.equal(report.result.raw, "fail");
    assert.equal(report.result.overall, "fail");
    assert.equal("baselineKb" in report, false);
    assert.equal("deltaKb" in report, false);

    const parsedReport = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    assert.equal(parsedReport.result.raw, "fail");
    assert.equal(parsedReport.result.overall, "fail");
    assert.equal("baselineKb" in parsedReport, false);
    assert.equal("deltaKb" in parsedReport, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("check overlay size: CLI should exit with error on invalid raw budget", () => {
  const workspace = createTempDir();
  try {
    const overlayFile = writeOverlayFile(workspace, "bundle/overlay.js", 256);
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      env: {
        ...process.env,
        OVERLAY_SIZE_FILE: overlayFile,
        OVERLAY_SIZE_BUDGET_RAW_KB: "0"
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid raw size budget/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("check overlay size: should ignore invalid baseline payload", () => {
  const workspace = createTempDir();
  try {
    const overlayFile = writeOverlayFile(workspace, "bundle/overlay.js", 4096);
    const reportFile = path.join(workspace, "reports", "overlay-size-report.json");
    const baselineFile = path.join(workspace, "baseline.json");
    fs.writeFileSync(baselineFile, JSON.stringify({ raw: "bad-value" }), "utf8");

    const { report } = runOverlaySizeCheck({
      overlayFile,
      reportFile,
      baselineFile,
      rawBudgetKb: 10,
      gzipBudgetKb: 10
    });

    assert.equal(report.result.overall, "pass");
    assert.equal("baselineKb" in report, false);
    assert.equal("deltaKb" in report, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("check overlay size: createReport should return deterministic budget verdicts", () => {
  const passReport = createReport(10, 5, 10, 5);
  const failReport = createReport(10.01, 5, 10, 5);

  assert.equal(passReport.result.overall, "pass");
  assert.equal(failReport.result.overall, "fail");
});
