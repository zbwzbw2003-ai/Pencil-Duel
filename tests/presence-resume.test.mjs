function resumeAfterBothPresent(state, net) {
  if (!(net.presence.player && net.presence.ai)) return state;
  if (state.pausedForDisconnect && state.status === 'playing') {
    state.pausedForDisconnect = false;
    state.phase = state.active === net.side ? 'playerAim' : 'onlineWaiting';
  }
  return state;
}

function pauseForDisconnect(state) {
  if (state.status !== 'playing') return state;
  state.pausedForDisconnect = true;
  state.phase = 'onlineWaiting';
  return state;
}

import test from 'node:test';
import assert from 'node:assert/strict';

const base = {
  status: 'playing',
  active: 'player',
  phase: 'playerAim',
  pausedForDisconnect: false
};

test('disconnect pauses a playing match and both players reconnecting resumes the host turn', () => {
  let state = pauseForDisconnect({...base});
  assert.equal(state.phase, 'onlineWaiting');
  assert.equal(state.pausedForDisconnect, true);

  state = resumeAfterBothPresent(state, {
    side: 'player',
    presence: {player: true, ai: true}
  });
  assert.equal(state.phase, 'playerAim');
  assert.equal(state.pausedForDisconnect, false);
});

test('guest turn resumes only for the guest, while the host keeps waiting', () => {
  let state = pauseForDisconnect({...base, active: 'ai', phase: 'onlineWaiting'});
  state = resumeAfterBothPresent(state, {
    side: 'ai',
    presence: {player: true, ai: true}
  });
  assert.equal(state.phase, 'playerAim');

  state = pauseForDisconnect({...base, active: 'ai', phase: 'onlineWaiting'});
  state = resumeAfterBothPresent(state, {
    side: 'player',
    presence: {player: true, ai: true}
  });
  assert.equal(state.phase, 'onlineWaiting');
});

test('a match does not resume until both presences are online', () => {
  const state = pauseForDisconnect({...base});
  const resumed = resumeAfterBothPresent(state, {
    side: 'player',
    presence: {player: true, ai: false}
  });
  assert.equal(resumed.phase, 'onlineWaiting');
  assert.equal(resumed.pausedForDisconnect, true);
});

test('finished and non-playing states are not paused by a disconnect', () => {
  for (const status of ['waiting', 'finished']) {
    const state = {status, phase: 'result', pausedForDisconnect: false};
    assert.deepEqual(pauseForDisconnect(state), state);
  }
});
