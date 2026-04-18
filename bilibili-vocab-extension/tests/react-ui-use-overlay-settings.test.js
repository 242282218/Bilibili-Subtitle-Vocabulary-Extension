const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'use-overlay-settings.ts');

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function areDepsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) {
      return false;
    }
  }

  return true;
}

function createFakeReactRuntime(hookFactory) {
  const hooks = [];
  let hookIndex = 0;
  let hasRendered = false;
  let currentResult = null;
  let pendingEffects = [];
  let needsRender = false;

  function render() {
    hookIndex = 0;
    pendingEffects = [];
    currentResult = hookFactory();
    hasRendered = true;

    const effectsToRun = pendingEffects.slice();
    pendingEffects = [];
    effectsToRun.forEach((effect) => {
      const previous = hooks[effect.index];
      if (previous && previous.kind === 'effect' && typeof previous.cleanup === 'function') {
        previous.cleanup();
      }

      const cleanup = effect.callback();
      hooks[effect.index] = {
        kind: 'effect',
        deps: effect.deps,
        cleanup: typeof cleanup === 'function' ? cleanup : null,
      };
    });
  }

  const react = {
    useState(initialValue) {
      const index = hookIndex;
      hookIndex += 1;

      if (!hooks[index]) {
        hooks[index] = {
          kind: 'state',
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        };
      }

      const setState = (nextValue) => {
        const previousValue = hooks[index].value;
        const resolvedValue =
          typeof nextValue === 'function' ? nextValue(previousValue) : nextValue;

        if (!Object.is(previousValue, resolvedValue)) {
          hooks[index].value = resolvedValue;
          needsRender = true;
        }
      };

      return [hooks[index].value, setState];
    },

    useRef(initialValue) {
      const index = hookIndex;
      hookIndex += 1;

      if (!hooks[index]) {
        hooks[index] = {
          kind: 'ref',
          value: { current: initialValue },
        };
      }

      return hooks[index].value;
    },

    useMemo(factory, deps) {
      const index = hookIndex;
      hookIndex += 1;
      const previous = hooks[index];

      if (previous && previous.kind === 'memo' && areDepsEqual(previous.deps, deps)) {
        return previous.value;
      }

      const value = factory();
      hooks[index] = {
        kind: 'memo',
        deps,
        value,
      };
      return value;
    },

    useCallback(callback, deps) {
      return react.useMemo(() => callback, deps);
    },

    useEffect(callback, deps) {
      const index = hookIndex;
      hookIndex += 1;
      const previous = hooks[index];
      const shouldRun =
        !previous || previous.kind !== 'effect' || !areDepsEqual(previous.deps, deps);

      if (shouldRun) {
        pendingEffects.push({
          index,
          callback,
          deps,
        });
      }
    },
  };

  return {
    react,

    result() {
      return currentResult;
    },

    async flush() {
      if (!hasRendered) {
        render();
      }

      let idleRounds = 0;
      for (let index = 0; index < 30; index += 1) {
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setImmediate(resolve));

        if (!needsRender) {
          idleRounds += 1;
          if (idleRounds >= 3) {
            break;
          }
          continue;
        }

        idleRounds = 0;
        needsRender = false;
        render();
      }

      return currentResult;
    },

    unmount() {
      hooks.forEach((entry) => {
        if (entry && entry.kind === 'effect' && typeof entry.cleanup === 'function') {
          entry.cleanup();
        }
      });
    },
  };
}

function createHarness(options = {}) {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const calls = {
    load: 0,
    save: [],
    normalize: [],
    unsubscribed: false,
  };
  let externalListener = null;

  const overlaySettings = {
    normalizeSettingsV3(value) {
      const cloned = cloneJson(value);
      calls.normalize.push(cloned);
      if (typeof options.normalizeImpl === 'function') {
        return options.normalizeImpl(cloned);
      }
      return {
        ...cloned,
        normalized: true,
      };
    },
  };

  const overlayStorage = {
    loadOverlaySettingsV3() {
      calls.load += 1;
      if (typeof options.loadImpl === 'function') {
        return options.loadImpl();
      }
      return Promise.resolve(
        cloneJson(options.loadedSettings || { schemaVersion: 3, activeProfileId: 'balanced' })
      );
    },

    saveOverlaySettingsV3(settings) {
      calls.save.push(cloneJson(settings));
      if (typeof options.saveImpl === 'function') {
        return options.saveImpl(cloneJson(settings));
      }
      return Promise.resolve(cloneJson(settings));
    },

    subscribeOverlaySettingsChanges(listener) {
      externalListener = listener;
      return () => {
        if (externalListener === listener) {
          externalListener = null;
        }
        calls.unsubscribed = true;
      };
    },
  };

  const moduleRef = { exports: {} };
  let runtime = null;
  const fakeReactRuntime = createFakeReactRuntime(() =>
    runtime.useOverlaySettings(options.hookOptions || {})
  );
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    console,
    require(id) {
      if (id === 'react') {
        return fakeReactRuntime.react;
      }
      if (id === './overlay-settings') {
        return overlaySettings;
      }
      if (id === './overlay-storage') {
        return overlayStorage;
      }
      return require(id);
    },
  };

  sandbox.globalThis = sandbox;

  vm.runInNewContext(transpiled, sandbox, { filename: 'use-overlay-settings.js' });
  runtime = moduleRef.exports;

  return {
    calls,

    result() {
      return fakeReactRuntime.result();
    },

    async flush() {
      return fakeReactRuntime.flush();
    },

    emitExternalUpdate(nextSettings) {
      assert.equal(typeof externalListener, 'function');
      externalListener(cloneJson(nextSettings));
    },

    unmount() {
      fakeReactRuntime.unmount();
    },
  };
}

test('react ui use overlay settings: should initialize working state from loaded settings', async () => {
  const harness = createHarness({
    loadedSettings: {
      schemaVersion: 3,
      activeProfileId: 'balanced',
    },
  });

  await harness.flush();
  const result = harness.result();

  assert.equal(harness.calls.load, 1);
  assert.deepEqual(cloneJson(result.working), {
    schemaVersion: 3,
    activeProfileId: 'balanced',
  });
  assert.equal(result.dirty, false);
  assert.equal(result.saving, false);
  assert.equal(result.status, '配置已同步，可在视频页直接调节。');
});

test('react ui use overlay settings: should expose load failure status when initial read fails', async () => {
  const harness = createHarness({
    loadImpl() {
      return Promise.reject(new Error('load failed'));
    },
  });

  await harness.flush();
  const result = harness.result();

  assert.equal(result.working, null);
  assert.equal(result.status, '读取配置失败，请刷新后重试。');
});

test('react ui use overlay settings: should normalize local edits and keep them when external updates arrive while dirty', async () => {
  const harness = createHarness({
    loadedSettings: {
      schemaVersion: 3,
      activeProfileId: 'balanced',
    },
    normalizeImpl(value) {
      return {
        ...value,
        normalizedBy: 'test-normalizer',
      };
    },
  });

  await harness.flush();
  harness.result().setWorkingDirect({
    schemaVersion: 3,
    activeProfileId: 'manual',
  });
  await harness.flush();

  harness.emitExternalUpdate({
    schemaVersion: 3,
    activeProfileId: 'remote',
  });
  await harness.flush();

  const result = harness.result();

  assert.equal(harness.calls.normalize.length >= 1, true);
  assert.deepEqual(cloneJson(result.working), {
    schemaVersion: 3,
    activeProfileId: 'manual',
    normalizedBy: 'test-normalizer',
  });
  assert.equal(result.dirty, true);
  assert.equal(result.status, '检测到外部更新，当前保留未保存编辑。');
});

test('react ui use overlay settings: should apply clean external updates directly', async () => {
  const harness = createHarness({
    loadedSettings: {
      schemaVersion: 3,
      activeProfileId: 'balanced',
    },
  });

  await harness.flush();
  harness.emitExternalUpdate({
    schemaVersion: 3,
    activeProfileId: 'remote-clean',
  });
  await harness.flush();

  const result = harness.result();

  assert.deepEqual(cloneJson(result.working), {
    schemaVersion: 3,
    activeProfileId: 'remote-clean',
  });
  assert.equal(result.dirty, false);
  assert.equal(result.status, '已同步外部更新。');
});

test('react ui use overlay settings: should persist save success and keep failed save local edits', async () => {
  const savedHarness = createHarness({
    loadedSettings: {
      schemaVersion: 3,
      activeProfileId: 'balanced',
    },
    saveImpl() {
      return Promise.resolve({
        schemaVersion: 3,
        activeProfileId: 'persisted',
      });
    },
  });

  await savedHarness.flush();
  savedHarness.result().mutateWorking((settings) => ({
    ...settings,
    activeProfileId: 'edited',
  }));
  await savedHarness.flush();

  const persisted = await savedHarness.result().save('保存成功');
  await savedHarness.flush();

  assert.deepEqual(cloneJson(persisted), {
    schemaVersion: 3,
    activeProfileId: 'persisted',
  });
  assert.deepEqual(savedHarness.calls.save[0], {
    schemaVersion: 3,
    activeProfileId: 'edited',
    normalized: true,
  });
  assert.deepEqual(cloneJson(savedHarness.result().working), {
    schemaVersion: 3,
    activeProfileId: 'persisted',
  });
  assert.equal(savedHarness.result().dirty, false);
  assert.equal(savedHarness.result().status, '保存成功');
  assert.equal(savedHarness.result().saving, false);

  const failedHarness = createHarness({
    loadedSettings: {
      schemaVersion: 3,
      activeProfileId: 'balanced',
    },
    saveImpl() {
      return Promise.reject(new Error('save failed'));
    },
  });

  await failedHarness.flush();
  failedHarness.result().setWorkingDirect({
    schemaVersion: 3,
    activeProfileId: 'failed-edit',
  });
  await failedHarness.flush();

  const failedPersist = await failedHarness.result().save();
  await failedHarness.flush();

  assert.equal(failedPersist, null);
  assert.deepEqual(cloneJson(failedHarness.result().working), {
    schemaVersion: 3,
    activeProfileId: 'failed-edit',
    normalized: true,
  });
  assert.equal(failedHarness.result().dirty, true);
  assert.equal(failedHarness.result().status, '保存失败，请重试。');
  assert.equal(failedHarness.result().saving, false);
});
