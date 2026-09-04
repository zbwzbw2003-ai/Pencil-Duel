export const MAX_DRAG_POWER = 1;
export const FRICTION = 940;
export const MAX_SPEED = 660;
export const CENTER_HIT_TOLERANCE = 2;
export const EDGE = 42;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const SURFACES = [
  {name: 'SMOOTH', friction: 'LOW', factor: .92, range: 'STABLE'},
  {name: 'GRAIN', friction: 'MEDIUM', factor: 1, range: 'ANGLE GRAIN'},
  {name: 'ROUGH', friction: 'HIGH', factor: 1.10, range: 'ANGLE GRAIN'}
];

export function makeGame(width, height, hostToken, guestToken, random = secureRandom) {
  width = clamp(Math.round(Number(width) || 1000), 640, 1920);
  height = clamp(Math.round(Number(height) || 600), 420, 1080);
  return {
    version: 1,
    width,
    height,
    hostToken,
    guestToken,
    status: 'waiting',
    round: 1,
    turn: 'player',
    winner: null,
    readyAt: 0,
    lastActive: Date.now(),
    positions: {
      player: {x: width * .15, y: height * .68},
      ai: {x: width * .85, y: height * .32}
    },
    bases: {
      player: {x: width * .11, y: height * .68},
      ai: {x: width * .89, y: height * .32}
    },
    trails: [],
    surface: SURFACES[Math.floor(random() * SURFACES.length)]
  };
}

export function publicState(game) {
  return {
    version: game.version,
    width: game.width,
    height: game.height,
    status: game.status,
    round: game.round,
    turn: game.turn,
    winner: game.winner,
    readyAt: game.readyAt,
    positions: game.positions,
    bases: game.bases,
    trails: game.trails,
    surface: game.surface || SURFACES[1]
  };
}

export function simulateShot(game, owner, angle, power, random = secureRandom) {
  const start = game.positions[owner];
  const target = game.positions[owner === 'player' ? 'ai' : 'player'];
  let p = {...start};
  let speed = 180 + power * (MAX_SPEED - 180);
  const surface = game.surface || SURFACES[1];
  const friction = paperFrictionForAngle(angle, surface.factor);
  const velocity = {x: Math.cos(angle), y: Math.sin(angle)};
  const points = [{...p}];
  const dt = 1 / 60;
  let winner = null;
  let closest = Infinity;

  for (let i = 0; i < 240 && speed >= 18; i++) {
    const old = {...p};
    p.x += velocity.x * speed * dt;
    p.y += velocity.y * speed * dt;
    let hitBoundary = false;
    if (p.x < EDGE) { p.x = EDGE; hitBoundary = true; }
    if (p.x > game.width - EDGE) { p.x = game.width - EDGE; hitBoundary = true; }
    if (p.y < EDGE + 22) { p.y = EDGE + 22; hitBoundary = true; }
    if (p.y > game.height - EDGE - 44) { p.y = game.height - EDGE - 44; hitBoundary = true; }
    points.push({...p});

    const centerDistance = segmentDistance(old, p, target);
    closest = Math.min(closest, centerDistance);
    if (centerDistance <= CENTER_HIT_TOLERANCE) {
      winner = owner;
      break;
    }
    if (hitBoundary) break;
    speed = Math.max(0, speed - friction * dt);
  }

  return {
    owner,
    power,
    points,
    end: p,
    winner,
    closest,
    duration: Math.max(.18, (points.length - 1) * dt),
    seed: random() * 1000
  };
}

export function paperFrictionForAngle(angle, surfaceFactor = 1) {
  return FRICTION * (1 + Math.sin(angle * 2 + .65) * .09) * surfaceFactor;
}

export function segmentDistance(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(a.x - p.x, a.y - p.y);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function randomRoomCode(random = secureRandom) {
  let code = '';
  for (let i = 0; i < 6; i++) code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  return code;
}

export function secureRandom() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] / 4294967296;
}
