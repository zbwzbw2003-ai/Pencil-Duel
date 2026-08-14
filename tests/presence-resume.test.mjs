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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const base = {
  status: 'playing',
  active: 'player',
  phase: 'playerAim',
  pausedForDisconnect: false
};

let state = pauseForDisconnect({...base});
assert(state.phase === 'onlineWaiting', 'disconnect should pause the match');
assert(state.pausedForDisconnect === true, 'disconnect should set pausedForDisconnect');

state = resumeAfterBothPresent(state, {
  side: 'player',
  presence: {player: true, ai: true}
});
assert(state.phase === 'playerAim', 'host should regain aim after opponent reconnects');
assert(state.pausedForDisconnect === false, 'resume should clear pausedForDisconnect');

state = pauseForDisconnect({...base, active: 'ai', phase: 'onlineWaiting'});
state = resumeAfterBothPresent(state, {
  side: 'ai',
  presence: {player: true, ai: true}
});
assert(state.phase === 'playerAim', 'guest should regain aim when it is their turn');

state = pauseForDisconnect({...base, active: 'ai', phase: 'onlineWaiting'});
state = resumeAfterBothPresent(state, {
  side: 'player',
  presence: {player: true, ai: true}
});
assert(state.phase === 'onlineWaiting', 'host should keep waiting when it is guest turn');

console.log('presence-resume.test.mjs: all checks passed');
