import { DurableObject } from 'cloudflare:workers';
import {
  MAX_DRAG_POWER,
  clamp,
  makeGame,
  publicState,
  randomRoomCode,
  simulateShot
} from './game-physics.js';

const ROOM_TTL = 24 * 60 * 60 * 1000;
const APP_BASES = ['/game1', '/apps/games/pencil'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const appBase = APP_BASES.find(base => url.pathname === base || url.pathname.startsWith(`${base}/`));
    if (appBase && url.pathname === appBase) return Response.redirect(new URL(`${appBase}/`, url), 308);
    const routePath = appBase ? url.pathname.slice(appBase.length) : url.pathname;

    if (routePath === '/api/health') {
      return json({ok: true, service: 'pencil-duel', transport: 'durable-object-websocket', rooms: 'ready'});
    }

    if (routePath === '/api/rooms' && request.method === 'POST') {
      const requested = await safeJson(request);
      const width = clamp(Math.round(Number(requested.width) || 1000), 640, 1920);
      const height = clamp(Math.round(Number(requested.height) || 600), 420, 1080);

      for (let attempt = 0; attempt < 8; attempt++) {
        const roomCode = randomRoomCode();
        const stub = env.ROOMS.getByName(roomCode);
        const response = await stub.fetch(new Request(`https://room.internal/create`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({width, height})
        }));
        if (response.status === 201) {
          const data = await response.json();
          return json({roomCode, token: data.token, side: 'player'}, 201);
        }
      }
      return json({error: '暂时无法分配房间码，请重试。'}, 503);
    }

    const match = routePath.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(join|socket)$/);
    if (match) {
      const [, roomCode, action] = match;
      const stub = env.ROOMS.getByName(roomCode);
      if (action === 'join' && request.method === 'POST') {
        return stub.fetch(new Request('https://room.internal/join', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(await safeJson(request))
        }));
      }
      if (action === 'socket' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        return stub.fetch(request);
      }
    }

    if (routePath.startsWith('/api/')) return json({error: 'Not found'}, 404);
    return env.ASSETS.fetch(request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = null;
    this.ctx.blockConcurrencyWhile(async () => {
      this.game = await this.ctx.storage.get('game') || null;
    });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/create' && request.method === 'POST') {
      if (this.game) return json({error: 'Room already exists'}, 409);
      const body = await safeJson(request);
      const hostToken = makeToken();
      this.game = makeGame(body.width, body.height, hostToken, null);
      await this.persist();
      return json({token: hostToken}, 201);
    }

    if (url.pathname === '/join' && request.method === 'POST') {
      if (!this.game) return json({error: '房间不存在或已经过期。'}, 404);
      const body = await safeJson(request);
      if (body.token && body.token === this.game.hostToken) return json({token: this.game.hostToken, side: 'player'});
      if (body.token && body.token === this.game.guestToken) return json({token: this.game.guestToken, side: 'ai'});
      if (this.game.guestToken) return json({error: '这个房间已经有两名玩家。'}, 409);
      this.game.guestToken = makeToken();
      this.game.lastActive = Date.now();
      await this.persist();
      return json({token: this.game.guestToken, side: 'ai'});
    }

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (!this.game) return new Response('Room not found', {status: 404});
      const token = url.searchParams.get('token') || '';
      const side = token === this.game.hostToken ? 'player' : token === this.game.guestToken ? 'ai' : null;
      if (!side) return new Response('Invalid room token', {status: 403});

      for (const oldSocket of this.ctx.getWebSockets(side)) {
        try { oldSocket.close(4001, 'Session replaced by a newer connection'); } catch {}
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [side]);
      server.serializeAttachment({side, token});

      if (side === 'ai' && this.game.status === 'waiting') {
        this.game.status = 'playing';
        this.game.lastActive = Date.now();
        await this.persist();
      }

      server.send(JSON.stringify({
        type: 'welcome',
        side,
        state: publicState(this.game),
        presence: this.presence()
      }));
      this.broadcast({type: 'state', state: publicState(this.game), presence: this.presence()}, server);
      return new Response(null, {status: 101, webSocket: client});
    }

    return json({error: 'Not found'}, 404);
  }

  async webSocketMessage(ws, rawMessage) {
    const attachment = ws.deserializeAttachment();
    if (!attachment || !this.game) return;

    let message;
    try { message = JSON.parse(typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage)); }
    catch { return this.sendError(ws, '消息格式无效。'); }

    if (message.type === 'shoot') {
      if (this.game.status !== 'playing') return this.sendError(ws, '对局尚未开始。');
      if (!this.presence().player || !this.presence().ai) return this.sendError(ws, '请等待对手重新连接。');
      if (attachment.side !== this.game.turn) return this.sendError(ws, '现在不是你的回合。');
      if (Date.now() < this.game.readyAt) return this.sendError(ws, '上一条轨迹仍在播放。');

      const angle = Number(message.angle);
      const power = Number(message.power);
      if (!Number.isFinite(angle) || !Number.isFinite(power) || power < .08 || power > MAX_DRAG_POWER) {
        return this.sendError(ws, '方向或力度无效。');
      }

      const shot = simulateShot(this.game, attachment.side, angle, power);
      const moving = this.game.positions[attachment.side];
      moving.x = shot.end.x;
      moving.y = shot.end.y;
      this.game.trails.push({owner: attachment.side, points: shot.points, seed: shot.seed});
      if (this.game.trails.length > 80) this.game.trails.shift();

      if (shot.winner) {
        this.game.status = 'finished';
        this.game.winner = shot.winner;
      } else if (attachment.side === 'player') {
        this.game.turn = 'ai';
      } else {
        this.game.turn = 'player';
        this.game.round += 1;
      }
      this.game.readyAt = Date.now() + Math.ceil(shot.duration * 1000) + 220;
      this.game.lastActive = Date.now();
      await this.persist();
      this.broadcast({type: 'shot', shot, state: publicState(this.game)});
      return;
    }

    if (message.type === 'restart') {
      if (this.game.status !== 'finished') return this.sendError(ws, '只能在本局结束后发起重赛。');
      const {width, height, hostToken, guestToken} = this.game;
      this.game = makeGame(width, height, hostToken, guestToken);
      this.game.status = this.presence().player && this.presence().ai ? 'playing' : 'waiting';
      await this.persist();
      this.broadcast({type: 'state', state: publicState(this.game), presence: this.presence()});
    }
  }

  webSocketClose() {
    this.broadcast({type: 'presence', presence: this.presence()});
  }

  webSocketError() {
    this.broadcast({type: 'presence', presence: this.presence()});
  }

  async alarm() {
    if (!this.game) return;
    const remaining = ROOM_TTL - (Date.now() - this.game.lastActive);
    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + remaining);
      return;
    }
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(4004, 'Room expired'); } catch {}
    }
    this.game = null;
    await this.ctx.storage.deleteAll();
  }

  presence() {
    const connected = side => this.ctx.getWebSockets(side).some(ws => ws.readyState === 1);
    return {player: connected('player'), ai: connected('ai')};
  }

  broadcast(message, except = null) {
    const data = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== 1) continue;
      try { socket.send(data); } catch {}
    }
  }

  sendError(ws, message) {
    try { ws.send(JSON.stringify({type: 'error', message})); } catch {}
  }

  async persist() {
    await this.ctx.storage.put('game', this.game);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
  }
}

function makeToken() {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}
  });
}
