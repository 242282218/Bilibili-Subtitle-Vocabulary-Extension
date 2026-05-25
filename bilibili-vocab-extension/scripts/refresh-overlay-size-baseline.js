const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REPORT_FILE = path.resolve(__dirname, '..', 'dist', 'overlay-size-report.json');
const DEFAULT_BASELINE_FILE = path.resolve(__dirname, '..', 'config', 'overlay-size-baseline.json');

function assertPositiveNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid ${label} in overlay size report.`);
  }
  return Number(numeric.toFixed(2));
}

function normalizeReport(rawReport) {
  if (!rawReport || typeof rawReport !== 'object') {
    throw new Error('Invalid overlay size report payload.');
  }

  if (!rawReport.actualKb || typeof rawReport.actualKb !== 'object') {
    throw new Error('Invalid overlay size report payload: missing actualKb.');
  }

  return {
    raw: assertPositiveNumber(rawReport.actualKb.raw, 'actualKb.raw'),
    gzip: assertPositiveNumber(rawReport.actualKb.gzip, 'actualKb.gzip'),
    checkedAt: rawReport.checkedAt ? String(rawReport.checkedAt) : new Date().toISOString(),
  };
}

function refreshOverlaySizeBaseline(options = {}) {
  const reportFile = path.resolve(
    options.reportFile || process.env.OVERLAY_SIZE_REPORT_FILE || DEFAULT_REPORT_FILE
  );
  const baselineFile = path.resolve(
    options.baselineFile || process.env.OVERLAY_SIZE_BASELINE_FILE || DEFAULT_BASELINE_FILE
  );

  if (!fs.existsSync(reportFile)) {
    throw new Error(
      `Missing ${reportFile}. Run 'pnpm run build:extension' before refreshing baseline.`
    );
  }

  const reportPayload = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const normalizedReport = normalizeReport(reportPayload);
  const baselinePayload = {
    raw: normalizedReport.raw,
    gzip: normalizedReport.gzip,
    capturedAt: normalizedReport.checkedAt,
    source: 'dist/overlay-size-report.json',
  };

  fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
  fs.writeFileSync(baselineFile, `${JSON.stringify(baselinePayload, null, 2)}\n`, 'utf8');

  return {
    reportFile,
    baselineFile,
    baseline: baselinePayload,
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    return {};
  }

  throw new Error(`Unknown overlay baseline option: ${argv[0]}`);
}

function runCli() {
  try {
    parseCliArgs();
    const { baselineFile, baseline } = refreshOverlaySizeBaseline();
    console.log(
      `[overlay-size-baseline] updated ${baselineFile} (raw=${baseline.raw}KB, gzip=${baseline.gzip}KB)`
    );
  } catch (error) {
    console.error(`[overlay-size-baseline] ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_REPORT_FILE,
  DEFAULT_BASELINE_FILE,
  normalizeReport,
  parseCliArgs,
  refreshOverlaySizeBaseline,
};
