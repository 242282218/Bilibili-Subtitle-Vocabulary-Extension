const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(PROJECT_ROOT, '..');
const PRIVACY_DOC = path.join(REPO_ROOT, 'docs', '隐私政策.md');
const PERMISSIONS_DOC = path.join(REPO_ROOT, 'docs', '权限说明.md');
const README = path.join(REPO_ROOT, 'README.md');

function readManifest() {
  const raw = fs
    .readFileSync(path.join(PROJECT_ROOT, 'manifest.json'), 'utf8')
    .replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function readRepoDoc(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function getContentScriptMatches(manifest) {
  const entries = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const firstEntry = entries[0] || {};
  return Array.isArray(firstEntry.matches) ? firstEntry.matches : [];
}

function getWebAccessibleMatches(manifest) {
  const entries = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources
    : [];
  const firstEntry = entries[0] || {};
  return Array.isArray(firstEntry.matches) ? firstEntry.matches : [];
}

test('permission strategy contract: default manifest should use minimal Bilibili and YouTube scope', () => {
  const manifest = readManifest();
  const permissionsDoc = readRepoDoc(PERMISSIONS_DOC);
  const matches = getContentScriptMatches(manifest);
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  const webAccessibleMatches = getWebAccessibleMatches(manifest);
  const optionalHostPermissions = Array.isArray(manifest.optional_host_permissions)
    ? manifest.optional_host_permissions
    : [];

  assert.deepEqual(matches, ['https://www.bilibili.com/*', 'https://www.youtube.com/*']);
  assert.deepEqual(permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(hostPermissions, [
    'https://www.bilibili.com/*',
    'https://api.bilibili.com/*',
    'https://aisubtitle.hdslb.com/*',
    'https://www.youtube.com/*',
  ]);
  assert.deepEqual(webAccessibleMatches, [
    'https://www.bilibili.com/*',
    'https://www.youtube.com/*',
  ]);
  assert.equal(matches.includes('http://*/*'), false);
  assert.equal(matches.includes('https://*/*'), false);
  assert.equal(webAccessibleMatches.includes('http://*/*'), false);
  assert.equal(webAccessibleMatches.includes('https://*/*'), false);
  assert.equal(
    hostPermissions.some((permission) => /v\.qq|iqiyi|netflix|youku/.test(permission)),
    false
  );
  assert.deepEqual(optionalHostPermissions, ['*://*/*']);
  assert.match(permissionsDoc, /Optional Host 权限[\s\S]*"\*:\/\/\*\/\*"/);
  assert.match(permissionsDoc, /默认内容脚本只运行在/);
});

test('permission strategy contract: target state should be minimal Bilibili and YouTube injection', () => {
  const permissionsDoc = readRepoDoc(PERMISSIONS_DOC);
  const privacy = readRepoDoc(PRIVACY_DOC);

  assert.match(permissionsDoc, /默认内容脚本只运行在/);
  assert.match(permissionsDoc, /"https:\/\/www\.bilibili\.com\/\*"/);
  assert.match(permissionsDoc, /"https:\/\/www\.youtube\.com\/\*"/);
  assert.match(permissionsDoc, /不会自动运行在所有 `http:\/\/\*\/\*` 或 `https:\/\/\*\/\*` 页面/);
  assert.match(permissionsDoc, /用户主动点击的授权按钮/);
  assert.match(permissionsDoc, /拒绝授权后不启用当前站点/);
  assert.match(privacy, /显式用户授权 UI/);
});

test('permission docs contract: README should link privacy and permission docs', () => {
  const readme = readRepoDoc(README);

  assert.match(readme, /\[隐私政策\]\(docs\/隐私政策\.md\)/);
  assert.match(readme, /\[权限说明\]\(docs\/权限说明\.md\)/);
  assert.match(readme, /默认自动注入范围仅限 Bilibili 和 YouTube/);
  assert.match(readme, /chrome\.storage\.local/);
  assert.match(readme, /optional_host_permissions: \*:\/\/\*\/\*/);
});

test('permission docs contract: public docs should match manifest permissions', () => {
  const manifest = readManifest();
  const privacy = readRepoDoc(PRIVACY_DOC);
  const permissions = readRepoDoc(PERMISSIONS_DOC);
  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  const optionalHostPermissions = Array.isArray(manifest.optional_host_permissions)
    ? manifest.optional_host_permissions
    : [];

  assert.match(privacy, /chrome\.storage\.local/);
  assert.match(privacy, /不会把学习数据、已收藏词、设置或指标发送到项目自有服务器/);
  assert.match(privacy, /Bilibili 官方播放器和字幕 API/);
  assert.match(privacy, /YouTube[\s\S]*caption DOM/);
  assert.match(privacy, /显式用户授权 UI/);

  for (const permission of manifest.permissions || []) {
    assert.match(permissions, new RegExp(`\`${permission}\``));
  }

  for (const hostPermission of hostPermissions) {
    assert.match(permissions, new RegExp(hostPermission.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const optionalHostPermission of optionalHostPermissions) {
    assert.match(
      permissions,
      new RegExp(optionalHostPermission.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  }

  assert.match(permissions, /不会自动运行在所有 `http:\/\/\*\/\*` 或 `https:\/\/\*\/\*` 页面/);
  assert.match(permissions, /当前站点授权状态/);
  assert.match(permissions, /拒绝授权后不启用当前站点/);
});
