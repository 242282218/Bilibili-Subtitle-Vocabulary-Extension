const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DEFAULT_OVERLAY_FILE = path.resolve(__dirname, "..", "dist", "overlay.js");
const DEFAULT_OVERLAY_REPORT_FILE = path.resolve(__dirname, "..", "dist", "overlay-size-report.json");
const DEFAULT_RAW_BUDGET_KB = 260;
const DEFAULT_GZIP_BUDGET_KB = 70;

function toKb(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

function parseBudget(rawValue, fallback) {
  if (rawValue == null || rawValue === "") {
    return fallback;
  }
  return Number(rawValue);
}

function assertPositiveBudget(rawBudgetKb, gzipBudgetKb) {
  if (!Number.isFinite(rawBudgetKb) || rawBudgetKb <= 0) {
    throw new Error("Invalid raw size budget. Use OVERLAY_SIZE_BUDGET_RAW_KB with a positive number.");
  }
  if (!Number.isFinite(gzipBudgetKb) || gzipBudgetKb <= 0) {
    throw new Error("Invalid gzip size budget. Use OVERLAY_SIZE_BUDGET_GZIP_KB with a positive number.");
  }
}

function evaluateBudgets(rawKb, gzipKb, rawBudgetKb, gzipBudgetKb) {
  const rawPass = rawKb <= rawBudgetKb;
  const gzipPass = gzipKb <= gzipBudgetKb;
  return {
    raw: rawPass ? "pass" : "fail",
    gzip: gzipPass ? "pass" : "fail",
    overall: rawPass && gzipPass ? "pass" : "fail"
  };
}

function createReport(rawKb, gzipKb, rawBudgetKb, gzipBudgetKb) {
  return {
    checkedAt: new Date().toISOString(),
    file: "dist/overlay.js",
    budgetKb: {
      raw: rawBudgetKb,
      gzip: gzipBudgetKb
    },
    actualKb: {
      raw: rawKb,
      gzip: gzipKb
    },
    result: evaluateBudgets(rawKb, gzipKb, rawBudgetKb, gzipBudgetKb)
  };
}

function writeGithubSummary(summaryPath, report) {
  if (!summaryPath) {
    return;
  }

  const rawPass = report.result.raw === "pass";
  const gzipPass = report.result.gzip === "pass";
  const lines = [
    "### Overlay Size Gate",
    "",
    "| Metric | Actual | Budget | Result |",
    "| --- | ---: | ---: | --- |",
    `| Raw | ${report.actualKb.raw} KB | ${report.budgetKb.raw} KB | ${rawPass ? "OK" : "Exceeded"} |`,
    `| Gzip | ${report.actualKb.gzip} KB | ${report.budgetKb.gzip} KB | ${gzipPass ? "OK" : "Exceeded"} |`,
    "",
    `Overall: ${report.result.overall === "pass" ? "PASS" : "FAIL"}`,
    ""
  ];

  try {
    fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    console.warn(`[overlay-size-check] Failed to write GitHub summary: ${error && error.message ? error.message : error}`);
  }
}

function writeOverlaySizeReport(reportPath, report) {
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn(`[overlay-size-check] Failed to write report: ${error && error.message ? error.message : error}`);
  }
}

function runOverlaySizeCheck(options = {}) {
  const overlayFile = path.resolve(options.overlayFile || process.env.OVERLAY_SIZE_FILE || DEFAULT_OVERLAY_FILE);
  const reportFile = path.resolve(
    options.reportFile || process.env.OVERLAY_SIZE_REPORT_FILE || DEFAULT_OVERLAY_REPORT_FILE
  );
  const summaryPath = options.summaryPath || process.env.GITHUB_STEP_SUMMARY || "";
  const rawBudgetKb = parseBudget(options.rawBudgetKb, parseBudget(process.env.OVERLAY_SIZE_BUDGET_RAW_KB, DEFAULT_RAW_BUDGET_KB));
  const gzipBudgetKb = parseBudget(options.gzipBudgetKb, parseBudget(process.env.OVERLAY_SIZE_BUDGET_GZIP_KB, DEFAULT_GZIP_BUDGET_KB));

  assertPositiveBudget(rawBudgetKb, gzipBudgetKb);

  if (!fs.existsSync(overlayFile)) {
    throw new Error(`Missing ${overlayFile}. Run 'pnpm run build:extension' before this check.`);
  }

  const rawBuffer = fs.readFileSync(overlayFile);
  const gzipBuffer = zlib.gzipSync(rawBuffer);
  const rawKb = toKb(rawBuffer.byteLength);
  const gzipKb = toKb(gzipBuffer.byteLength);
  const report = createReport(rawKb, gzipKb, rawBudgetKb, gzipBudgetKb);

  writeGithubSummary(summaryPath, report);
  writeOverlaySizeReport(reportFile, report);

  return {
    overlayFile,
    reportFile,
    report
  };
}

function runCli() {
  try {
    const { report } = runOverlaySizeCheck();
    console.log(
      `[overlay-size-check] overlay.js raw=${report.actualKb.raw}KB (budget ${report.budgetKb.raw}KB), gzip=${report.actualKb.gzip}KB (budget ${report.budgetKb.gzip}KB)`
    );

    if (report.result.overall !== "pass") {
      console.error("[overlay-size-check] Overlay bundle exceeds budget.");
      process.exit(1);
    }

    console.log("[overlay-size-check] Passed.");
  } catch (error) {
    console.error(`[overlay-size-check] ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_OVERLAY_FILE,
  DEFAULT_OVERLAY_REPORT_FILE,
  DEFAULT_RAW_BUDGET_KB,
  DEFAULT_GZIP_BUDGET_KB,
  parseBudget,
  toKb,
  evaluateBudgets,
  createReport,
  runOverlaySizeCheck
};
