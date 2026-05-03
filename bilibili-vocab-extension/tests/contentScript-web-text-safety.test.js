const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const previousDocument = global.document;
const previousNodeFilter = global.NodeFilter;

const webTextReplacementPath = require.resolve('../webTextReplacement.js');

class TestElement {
  constructor(tagName, attributes = [], children = []) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = children;
  }
}

function collectElements(root) {
  const elements = [];
  const visit = (node) => {
    if (!node || !node.tagName || node.tagName === '#text') {
      return;
    }
    elements.push(node);
    for (const child of node.children || []) {
      visit(child);
    }
  };
  visit(root);
  return elements;
}

function findElement(root, predicate) {
  if (!root || !root.tagName) {
    return null;
  }
  if (predicate(root)) {
    return root;
  }
  for (const child of root.children || []) {
    const found = findElement(child, predicate);
    if (found) {
      return found;
    }
  }
  return null;
}

class DomTextNode {
  constructor(text) {
    this.textContent = text;
    this.parentNode = null;
  }
}

class DomElement extends TestElement {
  constructor(tagName) {
    super(tagName.toUpperCase(), [], []);
    this.textContent = '';
    this.innerHTMLWrites = [];
  }

  appendChild(child) {
    if (child && typeof child === 'object') {
      child.parentNode = this;
    }
    this.children.push(child);
    return child;
  }

  replaceChild(newChild, oldChild) {
    this.replacedChild = newChild;
    this.removedChild = oldChild;
    if (newChild && typeof newChild === 'object') {
      newChild.parentNode = this;
    }
    return oldChild;
  }

  setAttribute(name, value) {
    const existing = this.attributes.find((attr) => attr.name === name);
    if (existing) {
      existing.value = String(value);
      return;
    }
    this.attributes.push({ name, value: String(value) });
  }

  getAttribute(name) {
    const attr = this.attributes.find((nextAttr) => nextAttr.name === name);
    return attr ? attr.value : null;
  }

  set innerHTML(value) {
    this.innerHTMLWrites.push(String(value));
    throw new Error('web text replacement must not write innerHTML');
  }

  get innerHTML() {
    return '';
  }
}

function createDomDocument() {
  return {
    createElement(tagName) {
      return new DomElement(tagName);
    },
    createTextNode(text) {
      return new DomTextNode(String(text || ''));
    },
    createTreeWalker(root) {
      const elements = collectElements(root);
      let index = 0;
      return {
        currentNode: elements[0] || null,
        nextNode() {
          index += 1;
          return elements[index] || null;
        },
      };
    },
  };
}

function loadWebTextReplacement() {
  delete require.cache[webTextReplacementPath];
  return require('../webTextReplacement.js');
}

test.before(() => {
  global.NodeFilter = {
    SHOW_ELEMENT: 1,
  };
  global.document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector() {
      return null;
    },
    createTreeWalker(root) {
      const elements = collectElements(root);
      let index = 0;
      return {
        currentNode: elements[0] || null,
        nextNode() {
          index += 1;
          return elements[index] || null;
        },
      };
    },
    body: {},
  };
});

function assertSafe(root) {
  const webTextReplacement = loadWebTextReplacement();
  assert.equal(webTextReplacement.containsUnsafeContent(root), false);
}

function assertUnsafe(root) {
  const webTextReplacement = loadWebTextReplacement();
  assert.equal(webTextReplacement.containsUnsafeContent(root), true);
}

test('containsUnsafeContent: allows safe span and div markup', () => {
  assertSafe(
    new TestElement(
      'DIV',
      [{ name: 'class', value: 'bili-vocab-bilingual-line' }],
      [
        new TestElement('SPAN', [
          { name: 'class', value: 'bili-vocab-word level-cet4' },
          { name: 'tabindex', value: '0' },
          { name: 'data-word', value: 'system' },
          { name: 'data-meaning', value: '系统' },
          { name: 'data-level', value: 'CET4' },
          { name: 'data-cefr-level', value: 'B1' },
          { name: 'data-frequency', value: '100' },
          { name: 'data-pos', value: 'noun' },
          { name: 'data-definition', value: 'a set of things' },
          { name: 'data-phonetic', value: '/ˈsɪstəm/' },
          { name: 'data-learning-status', value: 'new' },
          { name: 'data-source-text', value: '系统' },
          { name: 'data-original-subtitle', value: '系统学习' },
        ]),
      ]
    )
  );
});

test('containsUnsafeContent: rejects event handler attributes case-insensitively', () => {
  assertUnsafe(new TestElement('SPAN', [{ name: 'onClick', value: 'alert(1)' }]));
  assertUnsafe(new TestElement('SPAN', [{ name: 'oNeRrOr', value: 'alert(1)' }]));
});

test('containsUnsafeContent: rejects style attributes', () => {
  assertUnsafe(
    new TestElement('SPAN', [{ name: 'style', value: 'background:url(javascript:alert(1))' }])
  );
});

test('containsUnsafeContent: rejects unsafe URL attributes and protocols', () => {
  assertUnsafe(new TestElement('SPAN', [{ name: 'href', value: 'javascript:alert(1)' }]));
  assertUnsafe(new TestElement('SPAN', [{ name: 'formaction', value: 'javascript:alert(1)' }]));
  assertUnsafe(new TestElement('SPAN', [{ name: 'href', value: 'java&#x73;cript:alert(1)' }]));
  assertUnsafe(new TestElement('SPAN', [{ name: 'href', value: 'JaVaScRiPt:alert(1)' }]));
});

test('containsUnsafeContent: rejects safe URL attributes that are outside renderer allowlist', () => {
  assertUnsafe(new TestElement('SPAN', [{ name: 'href', value: 'https://example.test/word' }]));
});

test('containsUnsafeContent: rejects non-allowlisted tags and attributes', () => {
  assertUnsafe(new TestElement('IMG', [{ name: 'src', value: 'https://example.test/a.png' }]));
  assertUnsafe(new TestElement('SPAN', [{ name: 'aria-label', value: 'word' }]));
});

test('webTextReplacement: should detect no-op and real web text replacements', () => {
  const webTextReplacement = loadWebTextReplacement();

  assert.equal(
    webTextReplacement.shouldReplaceWebTextNode(
      {
        mixedText: '保持原样',
        tokens: [{ type: 'text', text: '保持原样' }],
      },
      '  保持原样  '
    ),
    false
  );
  assert.equal(
    webTextReplacement.shouldReplaceWebTextNode(
      {
        mixedText: '',
        tokens: [{ type: 'word', word: 'system' }],
      },
      '系统'
    ),
    true
  );
});

test('webTextReplacement: should delegate html rendering with runtime settings', () => {
  const webTextReplacement = loadWebTextReplacement();
  const calls = [];
  const result = { mixedText: 'translated' };
  const settings = { bilingualMode: 'bilingual' };

  const html = webTextReplacement.renderWebTextReplacementHtml(result, '原句', settings, {
    renderToHtml(nextResult, sourceText, runtimeSettings) {
      calls.push({ nextResult, sourceText, runtimeSettings });
      return '<span class="bili-vocab-word">translated</span>';
    },
  });

  assert.equal(html, '<span class="bili-vocab-word">translated</span>');
  assert.deepEqual(calls, [{ nextResult: result, sourceText: '原句', runtimeSettings: settings }]);
});

test('processWebTextNode: builds safe DOM nodes without using innerHTML renderer output', async () => {
  const webTextReplacement = loadWebTextReplacement();
  const doc = createDomDocument();
  const parent = new DomElement('p');
  const textNode = new DomTextNode('系统学习');
  textNode.parentNode = parent;

  const replaced = await webTextReplacement.processWebTextNode(textNode, {
    document: doc,
    NodeFilter: { SHOW_ELEMENT: 1 },
    getSettings() {
      return { enabled: true, webPageEnabled: true, bilingualMode: 'default' };
    },
    getRenderGeneration() {
      return 1;
    },
    createCacheKey(text) {
      return text;
    },
    readCache() {
      return null;
    },
    writeCache() {},
    async translateText() {
      return {
        mixedText: 'system学习',
        tokens: [
          {
            type: 'word',
            word: 'system',
            meaning: '系统',
            level: 'CET4',
            sourceText: '系统',
          },
          { type: 'text', text: '学习' },
        ],
      };
    },
    renderToHtml() {
      throw new Error('html renderer should not be used for web text replacement');
    },
  });

  assert.equal(replaced, true);
  assert.equal(parent.replacedChild.tagName, 'SPAN');
  const wordElement = findElement(
    parent.replacedChild,
    (element) => element.getAttribute && element.getAttribute('data-word') === 'system'
  );
  assert.ok(wordElement);
  assert.match(wordElement.getAttribute('class'), /\bbili-vocab-word\b/);
  assert.equal(wordElement.getAttribute('data-meaning'), '系统');
});

test('webTextReplacement contract: manifest should load module before contentScript', () => {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const shippedEntry = contentScripts.find((entry) => Array.isArray(entry.js));
  assert.ok(shippedEntry, 'content_scripts entry should exist');

  const webTextIndex = shippedEntry.js.indexOf('webTextReplacement.js');
  const contentScriptIndex = shippedEntry.js.indexOf('contentScript.js');
  assert.notEqual(webTextIndex, -1);
  assert.notEqual(contentScriptIndex, -1);
  assert.ok(webTextIndex < contentScriptIndex);
});

test.after(() => {
  delete require.cache[webTextReplacementPath];
  global.document = previousDocument;
  global.NodeFilter = previousNodeFilter;
});
