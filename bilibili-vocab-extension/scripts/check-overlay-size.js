const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OVERLAY_FILE = path.resolve(__dirname, "..", "dist", "overlay.js");
const RAW_BUDGET_KB = Number(process.env.OVERLAY_SIZE_BUDGET_RAW_KB || 500);
const GZIP_BUDGET_KB = Number(process.env.OVERLAY_SIZE_BUDGET_GZIP_KB || 155);

function toKb(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

function fail(message) {
  console.error(`[overlay-size-check] ${message}`);
  process.exit(1);
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

if (rawKb > RAW_BUDGET_KB || gzipKb > GZIP_BUDGET_KB) {
  fail("Overlay bundle exceeds budget.");
}

console.log("[overlay-size-check] Passed.");
