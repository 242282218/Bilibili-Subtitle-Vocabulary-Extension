const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const PROJECT_ROOT = path.join(__dirname, '..');
const EDGE_EXECUTABLE_CANDIDATES = [
  process.env.BILI_VOCAB_EXTENSION_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function ensureExtensionBuildExists() {
  const requiredPaths = [
    path.join(PROJECT_ROOT, 'manifest.json'),
    path.join(PROJECT_ROOT, 'dist', 'options.html'),
    path.join(PROJECT_ROOT, 'dist', 'popup.html'),
    path.join(PROJECT_ROOT, 'dist', 'overlay.js'),
  ];

  for (const requiredPath of requiredPaths) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Extension build artifact missing: ${requiredPath}`);
    }
  }
}

function resolveBrowserExecutable() {
  for (const candidate of EDGE_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Chromium browser executable not found. Checked: ${EDGE_EXECUTABLE_CANDIDATES.join(', ')}`
  );
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>Bili Vocab Smoke Fixture</title>
  </head>
  <body>
    <main>
      <h1>Smoke Fixture</h1>
      <video controls preload="metadata"></video>
    </main>
  </body>
</html>`);
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve smoke fixture server address'));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/fixture.html`,
      });
    });
  });
}

function stopFixtureServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
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

test('browser extension smoke: should load popup/options and inject overlay on a real page', async () => {
  ensureExtensionBuildExists();

  const executablePath = resolveBrowserExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-vocab-extension-smoke-'));
  const { server, url } = await startFixtureServer();
  let context = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: true,
      args: [`--disable-extensions-except=${PROJECT_ROOT}`, `--load-extension=${PROJECT_ROOT}`],
    });

    const extensionId = await resolveExtensionId(context);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/dist/options.html`);
    await optionsPage.waitForSelector('text=学习配置档');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/dist/popup.html`);
    await popupPage.waitForSelector('text=学习策略快控台');
    await popupPage.waitForSelector('text=当前字幕导航');

    const contentPage = await context.newPage();
    await contentPage.goto(url);
    await contentPage.waitForSelector('#bili-vocab-react-overlay-style', { state: 'attached' });
    await contentPage.waitForSelector('#bili-vocab-react-overlay-root', { state: 'attached' });

    const overlaySnapshot = await contentPage.$eval('#bili-vocab-react-overlay-root', (node) => ({
      childCount: node.childElementCount,
      text: node.textContent || '',
    }));
    assert.ok(overlaySnapshot.childCount > 0);
    assert.match(String(overlaySnapshot.text || ''), /隐藏面板|保存|字幕/);
  } finally {
    if (context) {
      await context.close();
    }
    await stopFixtureServer(server);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
