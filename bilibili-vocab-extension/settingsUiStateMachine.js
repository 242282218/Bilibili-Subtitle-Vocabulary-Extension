(function (globalScope) {
  const STATES = ['idle', 'editing', 'dirty', 'saving', 'synced', 'error'];

  const STATUS_MESSAGES = Object.freeze({
    idle: '配置已同步',
    editing: '正在编辑',
    dirty: '有未保存更改',
    saving: '正在保存...',
    synced: '已保存并同步',
    error: '保存失败，请重试',
  });

  const AUTOSAVE_MESSAGES = Object.freeze({
    idle: '等待保存',
    editing: '等待保存',
    dirty: '等待保存',
    saving: '保存中...',
    synced: '已自动保存',
    error: '保存失败',
  });

  const TRANSITIONS = Object.freeze({
    idle: Object.freeze({
      USER_EDIT: 'editing',
      MARK_DIRTY: 'dirty',
      SAVE_START: 'saving',
      SAVE_SUCCESS: 'synced',
      SAVE_FAILURE: 'error',
      RESET: 'idle',
    }),
    editing: Object.freeze({
      USER_EDIT: 'editing',
      MARK_DIRTY: 'dirty',
      SAVE_START: 'saving',
      SAVE_FAILURE: 'error',
      RESET: 'idle',
    }),
    dirty: Object.freeze({
      USER_EDIT: 'dirty',
      MARK_DIRTY: 'dirty',
      SAVE_START: 'saving',
      SAVE_FAILURE: 'error',
      DISCARD: 'idle',
      RESET: 'idle',
    }),
    saving: Object.freeze({
      SAVE_SUCCESS: 'synced',
      SAVE_FAILURE: 'error',
      RESET: 'idle',
    }),
    synced: Object.freeze({
      USER_EDIT: 'editing',
      MARK_DIRTY: 'dirty',
      SAVE_START: 'saving',
      SAVE_FAILURE: 'error',
      RESET: 'idle',
    }),
    error: Object.freeze({
      USER_EDIT: 'editing',
      MARK_DIRTY: 'dirty',
      SAVE_START: 'saving',
      RESET: 'idle',
    }),
  });

  function normalizeState(state) {
    const normalized = String(state || '')
      .trim()
      .toLowerCase();
    return STATES.includes(normalized) ? normalized : 'idle';
  }

  function normalizeEvent(event) {
    return String(event || '')
      .trim()
      .toUpperCase();
  }

  function nextState(currentState, event) {
    const state = normalizeState(currentState);
    const action = normalizeEvent(event);
    const map = TRANSITIONS[state];
    if (map && Object.prototype.hasOwnProperty.call(map, action)) {
      return map[action];
    }
    return state;
  }

  function getStateMessage(state, options = {}) {
    const channel = String(options.channel || 'status')
      .trim()
      .toLowerCase();
    const normalized = normalizeState(state);
    if (channel === 'autosave') {
      return AUTOSAVE_MESSAGES[normalized];
    }
    return STATUS_MESSAGES[normalized];
  }

  function createStateController(initialState = 'idle') {
    let state = normalizeState(initialState);
    return {
      getState() {
        return state;
      },
      setState(next) {
        state = normalizeState(next);
        return state;
      },
      dispatch(event) {
        state = nextState(state, event);
        return state;
      },
      getMessage(options) {
        return getStateMessage(state, options);
      },
    };
  }

  const api = {
    STATES,
    STATUS_MESSAGES,
    AUTOSAVE_MESSAGES,
    nextState,
    getStateMessage,
    createStateController,
  };

  globalScope.SettingsUiStateMachine = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
