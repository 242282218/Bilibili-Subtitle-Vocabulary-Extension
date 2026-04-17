const test = require('node:test');
const assert = require('node:assert/strict');

const stateMachine = require('../settingsUiStateMachine.js');

test('settings ui state machine: should expose canonical states', () => {
  assert.deepEqual(stateMachine.STATES, ['idle', 'editing', 'dirty', 'saving', 'synced', 'error']);
});

test('settings ui state machine: should follow editing -> dirty -> saving -> synced flow', () => {
  let state = 'idle';
  state = stateMachine.nextState(state, 'USER_EDIT');
  assert.equal(state, 'editing');

  state = stateMachine.nextState(state, 'MARK_DIRTY');
  assert.equal(state, 'dirty');

  state = stateMachine.nextState(state, 'SAVE_START');
  assert.equal(state, 'saving');

  state = stateMachine.nextState(state, 'SAVE_SUCCESS');
  assert.equal(state, 'synced');
});

test('settings ui state machine: should move to error on save failure', () => {
  const state = stateMachine.nextState('saving', 'SAVE_FAILURE');
  assert.equal(state, 'error');
});

test('settings ui state machine: should resolve feedback for status and autosave channels', () => {
  assert.equal(stateMachine.getStateMessage('dirty', { channel: 'status' }), '有未保存更改');
  assert.equal(stateMachine.getStateMessage('saving', { channel: 'autosave' }), '保存中...');
});
