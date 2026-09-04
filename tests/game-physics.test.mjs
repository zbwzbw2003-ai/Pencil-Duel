import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CENTER_HIT_TOLERANCE,
  EDGE,
  SURFACES,
  clamp,
  makeGame,
  paperFrictionForAngle,
  publicState,
  randomRoomCode,
  segmentDistance,
  simulateShot
} from '../src/game-physics.js';

const fixedRandom = () => 0.25;

function gameWithPositions(player, ai, overrides = {}) {
  return {
    ...makeGame(1000, 600, 'host', 'guest', fixedRandom),
    positions: {player: {...player}, ai: {...ai}},
    ...overrides
  };
}

test('clamp constrains values and makeGame normalizes board dimensions', () => {
  assert.equal(clamp(-4, 0, 10), 0);
  assert.equal(clamp(7, 0, 10), 7);
  assert.equal(clamp(99, 0, 10), 10);

  const game = makeGame('not a number', 9999, 'host', null, fixedRandom);
  assert.equal(game.width, 1000);
  assert.equal(game.height, 1080);
  assert.equal(game.surface.name, 'SMOOTH');
  assert.equal(game.positions.player.x, 150);
  assert.ok(Math.abs(game.positions.player.y - 734.4) < 1e-9);
  assert.equal(game.bases.ai.x, 890);
  assert.ok(Math.abs(game.bases.ai.y - 345.6) < 1e-9);
});

test('publicState exposes gameplay state without room credentials', () => {
  const game = makeGame(800, 500, 'host-secret', 'guest-secret', fixedRandom);
  const state = publicState(game);
  assert.equal(state.width, 800);
  assert.equal(state.height, 500);
  assert.equal(state.status, 'waiting');
  assert.equal(state.surface.name, 'SMOOTH');
  assert.equal('hostToken' in state, false);
  assert.equal('guestToken' in state, false);
});

test('randomRoomCode returns six characters from the unambiguous room alphabet', () => {
  const code = randomRoomCode(() => 0);
  assert.equal(code, 'AAAAAA');
  assert.match(code, /^[A-Z2-9]{6}$/);

  const last = randomRoomCode(() => .999999);
  assert.equal(last, '999999');
  assert.match(last, /^[A-Z2-9]{6}$/);
  assert.equal(/[IO01]/.test(last), false);
});

test('segmentDistance handles a point on a segment, outside endpoints, and zero-length segments', () => {
  assert.equal(segmentDistance({x: 0, y: 0}, {x: 10, y: 0}, {x: 5, y: 0}), 0);
  assert.equal(segmentDistance({x: 0, y: 0}, {x: 10, y: 0}, {x: 5, y: 3}), 3);
  assert.equal(segmentDistance({x: 0, y: 0}, {x: 10, y: 0}, {x: -4, y: 3}), 5);
  assert.equal(segmentDistance({x: 2, y: 3}, {x: 2, y: 3}, {x: 5, y: 7}), 5);
});

test('paper friction varies by angle and scales with surface friction', () => {
  const smooth = paperFrictionForAngle(0, SURFACES[0].factor);
  const grain = paperFrictionForAngle(0, SURFACES[1].factor);
  const rough = paperFrictionForAngle(0, SURFACES[2].factor);
  assert.ok(smooth < grain);
  assert.ok(grain < rough);
  assert.equal(paperFrictionForAngle(Math.PI, 1), paperFrictionForAngle(0, 1));
});

test('simulateShot makes a deterministic, non-bouncing edge-stopped trail', () => {
  const game = gameWithPositions({x: 100, y: 300}, {x: 900, y: 100});
  const shot = simulateShot(game, 'player', Math.PI, 1, fixedRandom);

  assert.equal(shot.owner, 'player');
  assert.equal(shot.power, 1);
  assert.equal(shot.winner, null);
  assert.equal(shot.end.x, EDGE);
  assert.equal(shot.seed, 250);
  assert.ok(shot.points.length > 1);
  assert.ok(shot.duration >= 0.18);
  for (let i = 1; i < shot.points.length; i++) {
    assert.ok(shot.points[i].x <= shot.points[i - 1].x + Number.EPSILON);
    assert.ok(shot.points[i].x >= EDGE);
  }
});

test('higher power travels farther than lower power on the same surface and angle', () => {
  const low = simulateShot(
    gameWithPositions({x: 100, y: 300}, {x: 900, y: 100}),
    'player', 0, .25, fixedRandom
  );
  const high = simulateShot(
    gameWithPositions({x: 100, y: 300}, {x: 900, y: 100}),
    'player', 0, 1, fixedRandom
  );
  assert.ok(high.end.x > low.end.x);
  assert.ok(high.points.length > low.points.length);
});

test('a trail crossing the exact target center wins within the configured tolerance', () => {
  const game = gameWithPositions({x: 100, y: 300}, {x: 300, y: 300});
  const shot = simulateShot(game, 'player', 0, 1, fixedRandom);
  assert.equal(shot.winner, 'player');
  assert.ok(shot.closest <= CENTER_HIT_TOLERANCE);
  assert.ok(shot.points.some(point => Math.abs(point.x - 300) < 12));
});

test('a near miss is not reported as a hit and keeps its closest distance', () => {
  const game = gameWithPositions({x: 100, y: 300}, {x: 300, y: 300});
  const shot = simulateShot(game, 'player', .14, 1, fixedRandom);
  assert.equal(shot.winner, null);
  assert.ok(shot.closest > CENTER_HIT_TOLERANCE);
  assert.ok(Number.isFinite(shot.closest));
});

test('the same simulation works for the AI side and respects the bottom boundary', () => {
  const game = gameWithPositions({x: 100, y: 100}, {x: 900, y: 500});
  const shot = simulateShot(game, 'ai', Math.PI / 2, 1, fixedRandom);
  assert.equal(shot.owner, 'ai');
  assert.equal(shot.end.y, 600 - EDGE - 44);
  assert.ok(shot.points.every(point => point.y <= 600 - EDGE - 44));
});

test('all four paper boundaries stop a trail without reflecting it', () => {
  const cases = [
    {start: {x: 800, y: 250}, angle: 0, expected: {x: 1000 - EDGE, y: 250}, axis: 'x', direction: 1},
    {start: {x: 300, y: 250}, angle: -Math.PI / 2, expected: {x: 300, y: EDGE + 22}, axis: 'y', direction: -1}
  ];

  for (const scenario of cases) {
    const shot = simulateShot(
      gameWithPositions(scenario.start, {x: 100, y: 550}),
      'player', scenario.angle, 1, fixedRandom
    );
    assert.deepEqual(shot.end, scenario.expected);
    const coordinates = shot.points.map(point => point[scenario.axis]);
    for (let i = 1; i < coordinates.length; i++) {
      assert.ok(
        scenario.direction > 0
          ? coordinates[i] >= coordinates[i - 1] - Number.EPSILON
          : coordinates[i] <= coordinates[i - 1] + Number.EPSILON
      );
    }
  }
});
