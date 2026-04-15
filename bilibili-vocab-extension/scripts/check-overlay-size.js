const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OVERLAY_FILE = path.resolve(__dirname, "..", "dist", "overlay.js");
const OVERLAY_REPORT_FILE = path.resolve(__dirname, "..", "dist", "overlay-size-report.json");
const RAW_BUDGET_KB = Number(process.env.OVERLAY_SIZE_BUDGET_RAW_KB || 260);
const GZIP_BUDGET_KB = Number(process.env.OVERLAY_SIZE_BUDGET_GZIP_KB || 70);

function toKb(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

function fail(message) {
  console.error(`[overlay-size-check] ${message}`);
  process.exit(1);
}

function writeGithubSummary(rawKb, gzipKb) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const rawPass = rawKb <= RAW_BUDGET_KB;
  const gzipPass = gzipKb <= GZIP_BUDGET_KB;
  const overallPass = rawPass && gzipPass;
  const lines = [
    "### Overlay Size Gate",
    "",
    "| Metric | Actual | Budget | Result |",
    "| --- | ---: | ---: | --- |",
    `| Raw | ${rawKb} KB | ${RAW_BUDGET_KB} KB | ${rawPass ? "OK" : "Exceeded"} |`,
    `| Gzip | ${gzipKb} KB | ${GZIP_BUDGET_KB} KB | ${gzipPass ? "OK" : "Exceeded"} |`,
    "",
    `Overall: ${overallPass ? "PASS" : "FAIL"}`,
    ""
  ];

  try {
    fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    console.warn(`[overlay-size-check] Failed to write GitHub summary: ${error && error.message ? error.message : error}`);
  }
}

function writeOverlaySizeReport(rawKb, gzipKb) {
  const rawPass = rawKb <= RAW_BUDGET_KB;
  const gzipPass = gzipKb <= GZIP_BUDGET_KB;
  const report = {
    checkedAt: new Date().toISOString(),
    file: "dist/overlay.js",
    budgetKb: {
      raw: RAW_BUDGET_KB,
      gzip: GZIP_BUDGET_KB
    },
    actualKb: {
      raw: rawKb,
      gzip: gzipKb
    },
    result: {
      raw: rawPass ? "pass" : "fail",
      gzip: gzipPass ? "pass" : "fail",
      overall: rawPass && gzipPass ? "pass" : "fail"
    }
  };

  try {
    fs.writeFileSync(OVERLAY_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn(`[overlay-size-check] Failed to write report: ${error && error.message ? error.message : error}`);
  }
}

if (!Number.isFinite(RAW_BUDGET_KB) || RAW_BUDGET_KB <= 0) {
  fail("Invalid raw size budget. Use OVERLAY_SIZE_BUDGET_RAW_KB with a positive number.");
}

if (!Number.isFinite(GZIP_BUDGET_KB) || GZIP_BUDGET_KB <= 0) {
  fail("Invalid gzip size budget. Use OVERLAY_SIZE_BUDGET_GZIP_KB with a positive number.");
}

if (!fs.existsSync(OVERLAY_FILE)) {
  fail(`Missing ${OVERLAY_FILE}. Run 'pnpm run build:extension' before this check.`);
}

const rawBuffer = fs.readFileSync(OVERLAY_FILE);
const gzipBuffer = zlib.gzipSync(rawBuffer);
const rawKb = toKb(rawBuffer.byteLength);
const gzipKb = toKb(gzipBuffer.byteLength);

console.log(
  `[overlay-size-check] overlay.js raw=${rawKb}KB (budget ${RAW_BUDGET_KB}KB), gzip=${gzipKb}KB (budget ${GZIP_BUDGET_KB}KB)`
);
writeGithubSummary(rawKb, gzipKb);
writeOverlaySizeReport(rawKb, gzipKb);

if (rawKb > RAW_BUDGET_KB || gzipKb > GZIP_BUDGET_KB) {
  fail("Overlay bundle exceeds budget.");
}

console.log("[overlay-size-check] Passed.");
