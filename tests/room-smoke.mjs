import assert from 'node:assert/strict';

const origin = process.env.PENCIL_DUEL_ORIGIN || 'http://127.0.0.1:8787';

function inbox(url) {
  const socket = new WebSocket(url);
  const queue = [];
  const waiters = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const waiter = waiters.find(item => item.type === message.type);
    if (waiter) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    } else queue.push(message);
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', reject, {once: true});
  });
  const next = (type, timeout = 5000) => {
    const existing = queue.find(item => item.type === type);
    if (existing) {
      queue.splice(queue.indexOf(existing), 1);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const waiter = {type, resolve};
      waiters.push(waiter);
      setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeout);
    });
  };
  return {socket, opened, next};
}

const health = await fetch(`${origin}/api/health`).then(response => response.json());
assert.equal(health.ok, true);

const createdResponse = await fetch(`${origin}/api/rooms`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({width: 1000, height: 600})
});
assert.equal(createdResponse.status, 201);
const created = await createdResponse.json();
assert.match(created.roomCode, /^[A-Z2-9]{6}$/);

const joinedResponse = await fetch(`${origin}/api/rooms/${created.roomCode}/join`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: '{}'
});
assert.equal(joinedResponse.status, 200);
const joined = await joinedResponse.json();

const wsOrigin = origin.replace(/^http/, 'ws');
const host = inbox(`${wsOrigin}/api/rooms/${created.roomCode}/socket?token=${encodeURIComponent(created.token)}`);
await host.opened;
const hostWelcome = await host.next('welcome');
assert.equal(hostWelcome.side, 'player');
assert.match(hostWelcome.state.surface.name, /^(SMOOTH|GRAIN|ROUGH)$/);

const guest = inbox(`${wsOrigin}/api/rooms/${created.roomCode}/socket?token=${encodeURIComponent(joined.token)}`);
await guest.opened;
const guestWelcome = await guest.next('welcome');
assert.equal(guestWelcome.side, 'ai');
assert.equal(guestWelcome.state.status, 'playing');

await host.next('state');
host.socket.send(JSON.stringify({type: 'shoot', angle: Math.PI, power: 1}));
const [hostShot, guestShot] = await Promise.all([host.next('shot'), guest.next('shot')]);
assert.deepEqual(hostShot.shot.points, guestShot.shot.points);
assert.equal(hostShot.shot.owner, 'player');
assert.equal(hostShot.state.turn, 'ai');
assert.ok(Number.isFinite(hostShot.shot.closest));
assert.ok(hostShot.shot.closest >= 0);
assert.equal(hostShot.state.surface.name, hostWelcome.state.surface.name, 'paper condition must remain fixed for the room');

const points = hostShot.shot.points;
assert.ok(points.length > 2);
assert.equal(points.at(-1).x, 42, 'left boundary must stop at x=42');
for (let i = 1; i < points.length; i++) {
  assert.ok(points[i].x <= points[i - 1].x, 'trajectory must never bounce backwards');
  assert.ok(points[i].x >= 42, 'trajectory must stay inside the paper boundary');
}

host.socket.close(1000, 'test complete');
guest.socket.close(1000, 'test complete');
console.log(`Room ${created.roomCode}: create, join, sync, authoritative shot, and edge-stop checks passed.`);
