const test = require('node:test');
const assert = require('node:assert/strict');

const experienceMetrics = require('../experienceMetrics.js');

test('experience metrics: should record context misreplace counters in snapshot window', async () => {
  experienceMetrics.__resetForTest();
  const now = 1700000000000;

  await experienceMetrics.recordEvent('context-misreplace', { severity: 'high', now });
  await experienceMetrics.recordEvent('context-misreplace', {
    severity: 'normal',
    now: now + 5000,
  });

  const snapshot = await experienceMetrics.readSnapshot({ days: 7, now: now + 6000 });
  assert.equal(snapshot.totalsWindow.contextMisreplaceReported, 2);
  assert.equal(snapshot.totalsWindow.contextMisreplaceHigh, 1);
});

test('experience metrics: should compute adaptive toggle disable rate', async () => {
  experienceMetrics.__resetForTest();
  const now = 1700000100000;

  await experienceMetrics.recordEvent('adaptive-toggle', { enabled: true, now });
  await experienceMetrics.recordEvent('adaptive-toggle', { enabled: false, now: now + 1000 });
  await experienceMetrics.recordEvent('adaptive-toggle', { enabled: false, now: now + 2000 });

  const snapshot = await experienceMetrics.readSnapshot({ days: 7, now: now + 3000 });
  assert.equal(snapshot.totalsWindow.adaptiveToggleEnabled, 1);
  assert.equal(snapshot.totalsWindow.adaptiveToggleDisabled, 2);
  assert.equal(snapshot.adaptiveToggleTotal, 3);
  assert.equal(snapshot.adaptiveToggleDisableRate, 0.6667);
});

test('experience metrics: should exclude events outside the configured window', async () => {
  experienceMetrics.__resetForTest();
  const now = 1700000200000;

  await experienceMetrics.recordEvent('adaptive-manual-override', {
    now: now - 10 * 24 * 60 * 60 * 1000,
  });
  await experienceMetrics.recordEvent('adaptive-manual-override', { now });

  const snapshot = await experienceMetrics.readSnapshot({ days: 7, now });
  assert.equal(snapshot.totalsWindow.adaptiveManualOverride, 1);
  assert.equal(snapshot.totalsAllTime.adaptiveManualOverride, 2);
});
