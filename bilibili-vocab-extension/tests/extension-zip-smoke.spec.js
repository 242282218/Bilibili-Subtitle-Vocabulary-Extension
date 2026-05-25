const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { runExtensionPackageCheck } = require('../scripts/check-extension-package.js');
const { createTempRoot, resolveBrowserExecutable } = require('./extension-smoke-helpers.js');

const PROJECT_ROOT = path.join(__dirname, '..');
const ZIP_PATH = path.join(PROJECT_ROOT, 'extension.zip');
const SUPPORTED_FIXTURE_URL = 'https://www.bilibili.com/zip-smoke-fixture.html';
const UNSUPPORTED_FIXTURE_URL = 'https://example.com/bili-vocab-zip-smoke-fixture.html';

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function extractZipArchive(zipPath, destinationDir, options = {}) {
  const platform = options.platform || process.platform;
  const runner = options.runner || spawnSync;
  const result =
    platform === 'win32'
      ? runner(
          'powershell',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `Expand-Archive -LiteralPath ${quotePowerShellLiteral(
              zipPath
            )} -DestinationPath ${quotePowerShellLiteral(destinationDir)} -Force`,
          ],
          { encoding: 'utf8' }
        )
      : runner('unzip', ['-q', zipPath, '-d', destinationDir], { encoding: 'utf8' });

  if (!result || result.status !== 0) {
    const stderr = result && result.stderr ? ` ${result.stderr}` : '';
    throw new Error(`Failed to extract extension archive.${stderr}`);
  }
}

function assertExtensionPackageGatePass() {
  const { report } = runExtensionPackageCheck({ packageFile: ZIP_PATH });

  assert.equal(
    report.result.overall,
    'pass',
    `Expected extension package gate to pass, got ${JSON.stringify(report.result)}`
  );

  return report;
}

function readExtractedManifest(extensionDir) {
  const raw = fs
    .readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')
    .replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function assertMinimalPermissionManifest(manifest) {
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const webAccessibleResources = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources
    : [];
  const contentScriptMatches =
    contentScripts[0] && Array.isArray(contentScripts[0].matches) ? contentScripts[0].matches : [];
  const webAccessibleMatches =
    webAccessibleResources[0] && Array.isArray(webAccessibleResources[0].matches)
      ? webAccessibleResources[0].matches
      : [];
  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];

  assert.deepEqual(contentScriptMatches, [
    'https://www.bilibili.com/*',
    'https://www.youtube.com/*',
  ]);
  assert.deepEqual(webAccessibleMatches, [
    'https://www.bilibili.com/*',
    'https://www.youtube.com/*',
  ]);
  assert.equal(hostPermissions.includes('https://v.qq.com/*'), false);
  assert.equal(hostPermissions.includes('https://www.iqiyi.com/*'), false);
  assert.equal(hostPermissions.includes('https://www.netflix.com/*'), false);
  assert.equal(hostPermissions.includes('https://v.youku.com/*'), false);
}

function readExtractedText(extensionDir, relativePath) {
  return fs.readFileSync(path.join(extensionDir, relativePath), 'utf8');
}

function assertReviewDanmakuRuntimeMarkers(extensionDir) {
  const danmakuSource = readExtractedText(extensionDir, 'scripts/danmaku.js');
  const schedulerSource = readExtractedText(extensionDir, 'scripts/scheduler.js');
  const contentScriptSource = readExtractedText(extensionDir, 'contentScript.js');
  const optionsBundleSource = readExtractedText(extensionDir, 'dist/assets/options.js');

  assert.match(danmakuSource, /#eaf6ff/);
  assert.match(danmakuSource, /#ffe8a8/);
  assert.match(danmakuSource, /rgba\(255, 255, 255, 0\.88\)/);
  assert.match(danmakuSource, /DENSITY_PRESET_TO_LIMITS/);
  assert.match(danmakuSource, /setDensityPreset/);
  assert.match(schedulerSource, /DENSITY_PRESET_TO_INTERVAL_MS/);
  assert.match(schedulerSource, /setDensityPreset/);
  assert.match(contentScriptSource, /reviewDanmakuDensity/);
  assert.match(contentScriptSource, /setDensityPreset/);
  assert.match(optionsBundleSource, /复习弹幕密度/);
}

function createFixtureHtml(title) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <video controls preload="metadata"></video>
    </main>
  </body>
</html>`;
}

async function routeFixturePage(page, url, title) {
  await page.route(url, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: createFixtureHtml(title),
    });
  });
}

async function resolveExtensionId(context) {
  let worker = context.serviceWorkers()[0] || null;
  if (!worker) {
    worker = await context.waitForEvent('serviceworker');
  }

  const match = /^chrome-extension:\/\/([^/]+)\//.exec(worker.url());
  assert.ok(match, `Expected extension service worker URL, got ${worker.url()}`);
  return match[1];
}

test('extension zip smoke: should load the unpacked archive as the delivered extension', async () => {
  assert.equal(fs.existsSync(ZIP_PATH), true, `Expected extension archive at ${ZIP_PATH}`);

  const executablePath = resolveBrowserExecutable();
  const tempRoot = createTempRoot('bili-vocab-zip-smoke-');
  const extensionDir = path.join(tempRoot, 'extension');
  const userDataDir = path.join(tempRoot, 'profile');
  fs.mkdirSync(extensionDir, { recursive: true });

  assertExtensionPackageGatePass();
  extractZipArchive(ZIP_PATH, extensionDir);
  assertMinimalPermissionManifest(readExtractedManifest(extensionDir));
  assertReviewDanmakuRuntimeMarkers(extensionDir);

  let context = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });

    const extensionId = await resolveExtensionId(context);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/dist/options.html`);
    await optionsPage.waitForSelector('text=字幕学习设置');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/dist/popup.html`);
    await popupPage.waitForSelector('text=当前页面学习助手');

    const contentPage = await context.newPage();
    await routeFixturePage(contentPage, SUPPORTED_FIXTURE_URL, 'Bili Vocab Zip Smoke Fixture');
    await contentPage.goto(SUPPORTED_FIXTURE_URL);
    await contentPage.waitForSelector('#bili-vocab-react-overlay-root', { state: 'attached' });

    const unsupportedPage = await context.newPage();
    await routeFixturePage(
      unsupportedPage,
      UNSUPPORTED_FIXTURE_URL,
      'Unsupported Zip Smoke Fixture'
    );
    await unsupportedPage.goto(UNSUPPORTED_FIXTURE_URL);
    await unsupportedPage.waitForLoadState('domcontentloaded');
    assert.equal(await unsupportedPage.locator('#bili-vocab-react-overlay-root').count(), 0);

    const dataResponse = await optionsPage.evaluate(async () => {
      const response = await fetch(chrome.runtime.getURL('data/cet4.json'));
      return {
        ok: response.ok,
        size: (await response.text()).length,
      };
    });
    assert.equal(dataResponse.ok, true);
    assert.ok(dataResponse.size > 100);
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
