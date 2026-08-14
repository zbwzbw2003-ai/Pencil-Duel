(() => {
  'use strict';

  const canvas = document.getElementById('onlineCanvas');
  const ctx = canvas.getContext('2d');
  const board = document.getElementById('boardWrap');
  const lobbyOverlay = document.getElementById('lobbyOverlay');
  const lobbyActions = document.getElementById('lobbyActions');
  const roomReady = document.getElementById('roomReady');
  const lobbyStatus = document.getElementById('lobbyStatus');
  const roomInput = document.getElementById('roomInput');
  const shareCode = document.getElementById('shareCode');
  const waitingText = document.getElementById('waitingText');
  const roomNumber = document.getElementById('roomNumber');
  const networkState = document.getElementById('networkState');
  const leftPlayerMeta = document.getElementById('leftPlayerMeta');
  const rightPlayerMeta = document.getElementById('rightPlayerMeta');
  const turnBanner = document.getElementById('turnBanner');
  const turnIndex = document.getElementById('turnIndex');
  const turnLabel = document.getElementById('turnLabel');
  const turnText = document.getElementById('turnText');
  const instructionTitle = document.getElementById('instructionTitle');
  const instructionText = document.getElementById('instructionText');
  const powerValue = document.getElementById('powerValue');
  const powerFill = document.getElementById('powerFill');
  const controlDock = document.getElementById('controlDock');
  const resultOverlay = document.getElementById('resultOverlay');
  const resultTitle = document.getElementById('resultTitle');
  const resultText = document.getElementById('resultText');
  const resultRoom = document.getElementById('resultRoom');
  const resultRounds = document.getElementById('resultRounds');
  const resetButton = document.getElementById('resetButton');
  const toast = document.getElementById('toast');

  const COLORS = {
    player: '#0e9999', playerDark: '#086e73',
    ai: '#df6c31', aiDark: '#a9471e', ink: '#263e3d'
  };
  const MAX_DRAG = 92;
  const MIN_DRAG = 10;
  const HOLD_POWER_MS = 1200;
  const DRAG_POWER_WEIGHT = .7;
  const HOLD_POWER_WEIGHT = .3;
  const FRICTION = 940;
  const MAX_SPEED = 660;
  const HIT_RADIUS = 16;
  const EDGE = 42;
  const APP_BASE = location.pathname === '/game1' || location.pathname.startsWith('/game1/') ? '/game1' : '';

  let W = 0, H = 0, dpr = 1, lastTime = performance.now();
  let toastTimer = null;
  const net = {
    socket: null,
    roomCode: '',
    token: '',
    side: null,
    serverW: 1000,
    serverH: 600,
    connected: false,
    intentionallyClosed: false,
    retries: 0,
    reconnectTimer: null,
    presence: {player: false, ai: false}
  };

  const state = {
    phase: 'lobby', round: 1, active: 'player', status: 'waiting', winner: null,
    player: {pos: {x: 0, y: 0}, angle: -.15},
    ai: {pos: {x: 0, y: 0}, angle: Math.PI},
    bases: {player: {x: 0, y: 0}, ai: {x: 0, y: 0}},
    trails: [], aiming: false, aimPoint: null, aimPower: 0,
    aimStart: null, aimStartedAt: 0, aimDragDistance: 0,
    pointerId: null, playback: null, pulse: 0, particles: [],
    pausedForDisconnect: false
  };

  function resize() {
    const rect = board.getBoundingClientRect();
    const oldW = W || rect.width, oldH = H || rect.height;
    W = Math.max(320, rect.width); H = Math.max(300, rect.height);
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    if (oldW && oldH && (oldW !== W || oldH !== H)) {
      const sx = W / oldW, sy = H / oldH;
      ['player', 'ai'].forEach(k => { state[k].pos.x *= sx; state[k].pos.y *= sy; });
      Object.values(state.bases).forEach(p => { p.x *= sx; p.y *= sy; });
      state.trails.forEach(t => t.points.forEach(p => { p.x *= sx; p.y *= sy; }));
      if (state.playback) state.playback.path.forEach(p => { p.x *= sx; p.y *= sy; });
    }
    if (!net.connected && state.trails.length === 0) setDefaultPositions();
  }

  function setDefaultPositions() {
    state.player.pos = {x: W * .15, y: H * .68};
    state.ai.pos = {x: W * .85, y: H * .32};
    state.bases.player = {x: W * .11, y: H * .68};
    state.bases.ai = {x: W * .89, y: H * .32};
  }

  function serverToLocal(p) {
    return {x: p.x / net.serverW * W, y: p.y / net.serverH * H};
  }

  function localToServer(p) {
    return {x: p.x / W * net.serverW, y: p.y / H * net.serverH};
  }

  function applySnapshot(snapshot, replaceTrails = true) {
    net.serverW = snapshot.width;
    net.serverH = snapshot.height;
    state.round = snapshot.round;
    state.active = snapshot.turn;
    state.status = snapshot.status;
    state.winner = snapshot.winner;
    state.player.pos = serverToLocal(snapshot.positions.player);
    state.ai.pos = serverToLocal(snapshot.positions.ai);
    state.bases.player = serverToLocal(snapshot.bases.player);
    state.bases.ai = serverToLocal(snapshot.bases.ai);
    if (replaceTrails) {
      state.trails = (snapshot.trails || []).map(t => ({
        owner: t.owner,
        seed: t.seed,
        points: t.points.map(serverToLocal)
      }));
    }
    const lastPlayer = [...state.trails].reverse().find(t => t.owner === 'player');
    const lastAi = [...state.trails].reverse().find(t => t.owner === 'ai');
    if (lastPlayer?.points.length > 1) state.player.angle = pathAngle(lastPlayer.points);
    if (lastAi?.points.length > 1) state.ai.angle = pathAngle(lastAi.points);

    turnIndex.textContent = String(state.round).padStart(2, '0');
    if (snapshot.status === 'finished') {
      state.phase = 'gameOver';
      showResult(snapshot.winner);
    } else if (snapshot.status === 'playing') {
      lobbyOverlay.hidden = true;
      resultOverlay.hidden = true;
      resetButton.disabled = true;
      state.pausedForDisconnect = false;
      state.phase = state.active === net.side ? 'playerAim' : 'onlineWaiting';
      updateTurnUI();
    } else {
      state.phase = 'onlineWaiting';
      showWaitingRoom();
    }
  }

  function updateTurnUI() {
    const mine = state.active === net.side;
    const orangeTurn = state.active === 'ai';
    turnBanner.classList.toggle('ai-turn', orangeTurn);
    turnLabel.textContent = mine ? 'YOUR MOVE' : 'RIVAL MOVE';
    turnText.textContent = mine ? '轮到你了' : '等待对手落笔';
    instructionTitle.textContent = mine ? '按住鼠标左键，朝出手方向滑动' : '对手正在选择方向与力度';
    instructionText.textContent = mine ? '滑动距离与按住时长共同决定力度，松开左键出手。' : '对手松手后，双方会同时看到服务器确认的划痕。';
    controlDock.classList.toggle('waiting', !mine);
    canvas.className = mine ? 'can-aim' : '';
    setPower(0);
  }

  function updatePresence(presence) {
    net.presence = presence || net.presence;
    leftPlayerMeta.textContent = net.side === 'player' ? '你' : (net.presence.player ? '对手在线' : '等待连接');
    rightPlayerMeta.textContent = net.side === 'ai' ? '你' : (net.presence.ai ? '对手在线' : '等待连接');
    if (net.presence.player && net.presence.ai) {
      networkState.textContent = 'LIVE';
      if (state.status === 'waiting') {
        waitingText.innerHTML = '<i></i> 两名玩家已连接，准备落笔';
      }
      if (state.pausedForDisconnect && state.status === 'playing') {
        state.pausedForDisconnect = false;
        state.phase = state.active === net.side ? 'playerAim' : 'onlineWaiting';
        updateTurnUI();
      }
    } else {
      networkState.textContent = net.connected ? 'WAITING' : 'RECONNECT';
      if (state.status === 'playing') {
        state.pausedForDisconnect = true;
        state.phase = 'onlineWaiting';
        turnLabel.textContent = 'PAUSED';
        turnText.textContent = '对手已断线，等待重连';
        canvas.className = '';
        controlDock.classList.add('waiting');
      }
    }
  }

  async function createRoom() {
    if (!canUseNetwork()) return;
    setLobbyBusy(true, '正在 Cloudflare 边缘创建房间…');
    try {
      const response = await fetch(`${APP_BASE}/api/rooms`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({width: Math.round(W), height: Math.round(H)})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '创建失败');
      saveCredentials(data.roomCode, data.token);
      connectSocket();
    } catch (error) {
      setLobbyBusy(false, `无法创建房间：${error.message}`);
    }
  }

  async function joinRoom() {
    if (!canUseNetwork()) return;
    const code = normalizeCode(roomInput.value);
    if (code.length !== 6) {
      lobbyStatus.textContent = '请输入 6 位房间码。';
      roomInput.focus();
      return;
    }
    setLobbyBusy(true, '正在加入房间…');
    try {
      const storedToken = localStorage.getItem(`pencil-duel:${code}`) || '';
      const response = await fetch(`${APP_BASE}/api/rooms/${code}/join`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({token: storedToken})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加入失败');
      saveCredentials(code, data.token);
      connectSocket();
    } catch (error) {
      setLobbyBusy(false, error.message);
    }
  }

  function saveCredentials(code, token) {
    net.roomCode = code;
    net.token = token;
    roomNumber.textContent = code;
    localStorage.setItem(`pencil-duel:${code}`, token);
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url);
  }

  function connectSocket(isReconnect = false) {
    clearTimeout(net.reconnectTimer);
    if (net.socket) {
      net.intentionallyClosed = true;
      net.socket.close();
    }
    net.intentionallyClosed = false;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${location.host}${APP_BASE}/api/rooms/${net.roomCode}/socket?token=${encodeURIComponent(net.token)}`);
    net.socket = socket;
    networkState.textContent = isReconnect ? 'RECONNECT' : 'CONNECTING';
    socket.addEventListener('open', () => {
      net.connected = true;
      net.retries = 0;
      networkState.textContent = 'CONNECTED';
    });
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      handleServerMessage(message);
    });
    socket.addEventListener('close', event => {
      if (socket !== net.socket) return;
      net.connected = false;
      networkState.textContent = 'RECONNECT';
      canvas.className = '';
      if (event.code === 4003 || event.code === 4004) {
        setLobbyBusy(false, event.reason || '房间凭证无效，请重新加入。');
        lobbyOverlay.hidden = false;
        return;
      }
      if (!net.intentionallyClosed && net.retries < 6) {
        net.retries += 1;
        net.reconnectTimer = setTimeout(() => connectSocket(true), Math.min(7000, 700 * 2 ** net.retries));
        showToast('连接中断，正在自动重连…');
      }
    });
    socket.addEventListener('error', () => {
      networkState.textContent = 'ERROR';
    });
  }

  function handleServerMessage(message) {
    if (message.type === 'welcome') {
      net.side = message.side;
      roomNumber.textContent = net.roomCode;
      applySnapshot(message.state);
      updatePresence(message.presence);
      return;
    }
    if (message.type === 'state') {
      state.playback = null;
      applySnapshot(message.state);
      updatePresence(message.presence);
      return;
    }
    if (message.type === 'presence') {
      updatePresence(message.presence);
      return;
    }
    if (message.type === 'shot') {
      startNetworkShot(message.shot, message.state);
      return;
    }
    if (message.type === 'error') {
      showToast(message.message || '服务器拒绝了这次操作。');
      if (state.status === 'playing') {
        state.phase = state.active === net.side ? 'playerAim' : 'onlineWaiting';
        updateTurnUI();
      }
    }
  }

  function startNetworkShot(shot, pendingState) {
    const path = shot.points.map(serverToLocal);
    const owner = shot.owner;
    const trail = {owner, seed: shot.seed, points: [path[0]]};
    state.trails.push(trail);
    state.active = owner;
    state.phase = 'networkMoving';
    state.playback = {path, trail, elapsed: 0, duration: Math.max(.18, shot.duration), pendingState, index: 0};
    turnBanner.classList.toggle('ai-turn', owner === 'ai');
    turnLabel.textContent = 'SERVER TRACE';
    turnText.textContent = owner === net.side ? '你的铅笔正在滑动' : '对手的铅笔正在滑动';
    canvas.className = '';
  }

  function updatePlayback(dt) {
    const pb = state.playback;
    if (!pb) return;
    pb.elapsed += dt;
    const progress = clamp(pb.elapsed / pb.duration, 0, 1);
    const floatIndex = progress * (pb.path.length - 1);
    const targetIndex = Math.floor(floatIndex);
    while (pb.index < targetIndex) {
      pb.index += 1;
      pb.trail.points.push(pb.path[pb.index]);
    }
    const nextIndex = Math.min(pb.path.length - 1, targetIndex + 1);
    const mix = floatIndex - targetIndex;
    const a = pb.path[targetIndex], b = pb.path[nextIndex];
    const unit = state[pb.trail.owner];
    unit.pos = {x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix};
    if (nextIndex !== targetIndex) unit.angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (progress >= 1) {
      pb.trail.points = pb.path.slice();
      const pending = pb.pendingState;
      state.playback = null;
      state.round = pending.round;
      state.active = pending.turn;
      state.status = pending.status;
      state.winner = pending.winner;
      state.player.pos = serverToLocal(pending.positions.player);
      state.ai.pos = serverToLocal(pending.positions.ai);
      turnIndex.textContent = String(state.round).padStart(2, '0');
      if (pending.status === 'finished') {
        state.phase = 'gameOver';
        spawnHitParticles(state[pending.winner].pos, pending.winner);
        setTimeout(() => showResult(pending.winner), 360);
      } else {
        state.phase = state.active === net.side ? 'playerAim' : 'onlineWaiting';
        updateTurnUI();
      }
    }
  }

  function sendShot(angle, power) {
    if (!net.connected || net.socket?.readyState !== WebSocket.OPEN) {
      showToast('网络尚未连接。');
      state.phase = 'playerAim';
      return;
    }
    net.socket.send(JSON.stringify({type: 'shoot', angle, power}));
    state.phase = 'onlineWaiting';
    turnLabel.textContent = 'SUBMITTED';
    turnText.textContent = '服务器正在计算随机滑程';
    instructionTitle.textContent = '已提交方向与力度';
    instructionText.textContent = '最终落点由服务器统一计算，双方结果完全一致。';
    controlDock.classList.add('waiting');
    canvas.className = '';
  }

  function requestRestart() {
    if (!net.connected || state.status !== 'finished') return;
    net.socket.send(JSON.stringify({type: 'restart'}));
    resetButton.disabled = true;
    showToast('已向服务器发起重赛。');
  }

  function showWaitingRoom() {
    lobbyOverlay.hidden = false;
    lobbyActions.hidden = true;
    roomReady.hidden = false;
    shareCode.textContent = net.roomCode;
    waitingText.innerHTML = '<i></i> 正在等待另一名玩家…';
    lobbyStatus.textContent = '';
    roomNumber.textContent = net.roomCode;
    networkState.textContent = 'WAITING';
  }

  function setLobbyBusy(busy, message = '') {
    document.getElementById('createRoomButton').disabled = busy;
    document.getElementById('joinRoomButton').disabled = busy;
    lobbyStatus.textContent = message;
  }

  function canUseNetwork() {
    if (location.protocol === 'file:') {
      lobbyStatus.textContent = '当前是本地文件模式。请部署到 Cloudflare，或运行 npm run dev 后再联机。';
      return false;
    }
    return true;
  }

  function copyInvite() {
    const url = new URL(location.href);
    url.searchParams.set('room', net.roomCode);
    const text = url.toString();
    navigator.clipboard?.writeText(text).then(
      () => showToast('邀请链接已复制。'),
      () => window.prompt('复制这个邀请链接：', text)
    );
  }

  function showResult(winner) {
    const won = winner === net.side;
    resultOverlay.hidden = false;
    resultOverlay.classList.toggle('lost', !won);
    resultTitle.textContent = won ? 'YOU WIN' : 'OPPONENT WINS';
    resultText.textContent = won ? '服务器确认：你的轨迹先截中了对手。' : '服务器确认：对手的轨迹先截中了你。';
    resultRoom.textContent = net.roomCode;
    resultRounds.textContent = String(state.round).padStart(2, '0');
    resetButton.disabled = false;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function pointerDown(e) {
    if (state.phase !== 'playerAim' || state.active !== net.side) return;
    if (state.aiming) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = pointFromEvent(e), unit = state[net.side];
    if (distance(p, unit.pos) > 60) return;
    e.preventDefault();
    state.aiming = true; state.pointerId = e.pointerId;
    state.aimStart = p; state.aimStartedAt = performance.now(); state.aimDragDistance = 0;
    state.aimPoint = {...unit.pos}; state.aimPower = 0;
    canvas.setPointerCapture(e.pointerId); canvas.className = 'is-aiming';
    instructionTitle.textContent = '滑动决定方向，距离 + 时长决定力度';
    instructionText.textContent = '力度会随按住时间增加；服务器会决定真实滑程。';
  }

  function pointerMove(e) {
    if (!state.aiming || e.pointerId !== state.pointerId) return;
    e.preventDefault();
    updateAimFromEvent(e);
  }

  function updateAimFromEvent(e) {
    const p = pointFromEvent(e), origin = state[net.side].pos;
    const dx = p.x - state.aimStart.x, dy = p.y - state.aimStart.y, len = Math.hypot(dx, dy);
    const scale = len > MAX_DRAG ? MAX_DRAG / len : 1;
    state.aimPoint = {x: origin.x + dx * scale, y: origin.y + dy * scale};
    state.aimDragDistance = len;
    updateAimPower();
  }

  function updateAimPower() {
    if (!state.aiming) return state.aimPower;
    const dragPower = Math.min(1, state.aimDragDistance / MAX_DRAG);
    const holdPower = Math.min(1, (performance.now() - state.aimStartedAt) / HOLD_POWER_MS);
    state.aimPower = Math.min(1, dragPower * DRAG_POWER_WEIGHT + holdPower * HOLD_POWER_WEIGHT);
    setPower(state.aimPower);
    return state.aimPower;
  }

  function pointerUp(e) {
    if (!state.aiming || e.pointerId !== state.pointerId) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    updateAimFromEvent(e);
    const power = updateAimPower();
    state.aiming = false;
    canvas.releasePointerCapture(e.pointerId);
    const unit = state[net.side];
    const dx = state.aimPoint.x - unit.pos.x, dy = state.aimPoint.y - unit.pos.y;
    const len = Math.hypot(dx, dy);
    state.aimPoint = null;
    if (len < MIN_DRAG) {
      state.aimPower = 0; setPower(0); updateTurnUI(); return;
    }
    const serverDx = dx / W * net.serverW;
    const serverDy = dy / H * net.serverH;
    sendShot(Math.atan2(serverDy, serverDx), Math.max(.08, power));
    state.aimPower = 0; state.aimStart = null; state.aimDragDistance = 0; setPower(0);
  }

  function pointerCancel(e) {
    if (!state.aiming || e.pointerId !== state.pointerId) return;
    state.aiming = false;
    state.aimPoint = null;
    state.aimPower = 0;
    state.aimStart = null;
    state.aimDragDistance = 0;
    setPower(0);
    updateTurnUI();
  }

  function pointFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    return {x: e.clientX - r.left, y: e.clientY - r.top};
  }

  function setPower(value) {
    const percent = Math.round(value * 100);
    powerValue.textContent = `${percent}%`;
    powerFill.style.width = `${percent}%`;
    powerFill.style.background = value > .78 ? '#ff9a5e' : '#50d3ca';
  }

  function update(dt) {
    state.pulse += dt;
    if (state.aiming) updateAimPower();
    if (state.phase === 'networkMoving') updatePlayback(dt);
    state.particles.forEach(p => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt; });
    state.particles = state.particles.filter(p => p.life > 0);
  }

  function frame(now) {
    const dt = Math.min(.033, (now - lastTime) / 1000 || .016);
    lastTime = now; update(dt); draw(); requestAnimationFrame(frame);
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawBoundary(); drawBases();
    state.trails.forEach(drawTrail);
    if (state.aiming && state.aimPoint) drawAimGuide();
    drawCurrentMarker('player'); drawCurrentMarker('ai');
    drawPencil('player'); drawPencil('ai'); drawParticles();
  }

  function drawBoundary() {
    ctx.save(); ctx.strokeStyle = 'rgba(25,59,57,.16)'; ctx.lineWidth = 1; ctx.setLineDash([2, 7]);
    ctx.strokeRect(EDGE - 12, EDGE + 10, W - (EDGE - 12) * 2, H - (EDGE + 10) - (EDGE + 32));
    ctx.setLineDash([]);
    cornerMark(EDGE - 12, EDGE + 10, 1, 1); cornerMark(W - EDGE + 12, EDGE + 10, -1, 1);
    cornerMark(EDGE - 12, H - EDGE - 32, 1, -1); cornerMark(W - EDGE + 12, H - EDGE - 32, -1, -1);
    ctx.restore();
  }

  function cornerMark(x, y, sx, sy) {
    ctx.beginPath(); ctx.moveTo(x, y + sy * 16); ctx.lineTo(x, y); ctx.lineTo(x + sx * 16, y); ctx.stroke();
  }

  function drawBases() {
    drawBase(state.bases.player, 'P1', COLORS.player, -1);
    drawBase(state.bases.ai, 'P2', COLORS.ai, 1);
  }

  function drawBase(p, label, color, direction) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.globalAlpha = .31; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, 31, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = .11; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .56; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 8px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${label} BASE`, 0, direction < 0 ? 48 : -43); ctx.restore();
  }

  function drawTrail(trail) {
    if (trail.points.length < 2) return;
    const color = trail.owner === 'player' ? COLORS.player : COLORS.ai;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const last = trail.points.length - 1;
    for (let i = 1; i <= last; i++) {
      const a = trail.points[i - 1], b = trail.points[i], t = (i - 1) / Math.max(1, last), fade = 1 - t * .74;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = color; ctx.globalAlpha = .24 * fade; ctx.lineWidth = 4.1 - t * 1.4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = '#263b3a'; ctx.globalAlpha = .75 * fade; ctx.lineWidth = 1.65 - t * .55; ctx.stroke();
      const j1x = Math.sin((i - 1) * 2.37 + trail.seed) * .72, j1y = Math.cos((i - 1) * 1.91 + trail.seed) * .58;
      const j2x = Math.sin(i * 2.37 + trail.seed) * .72, j2y = Math.cos(i * 1.91 + trail.seed) * .58;
      ctx.beginPath(); ctx.moveTo(a.x + j1x, a.y + j1y); ctx.lineTo(b.x + j2x, b.y + j2y); ctx.strokeStyle = '#172d2c'; ctx.globalAlpha = .24 * fade; ctx.lineWidth = .5; ctx.stroke();
    }
    ctx.restore();
  }

  function drawCurrentMarker(owner) {
    const unit = state[owner], color = owner === 'player' ? COLORS.player : COLORS.ai;
    const target = state.phase !== 'gameOver' && state.active !== owner;
    ctx.save(); ctx.translate(unit.pos.x, unit.pos.y); ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.globalAlpha = .12; ctx.beginPath(); ctx.arc(0, 0, HIT_RADIUS + 4 + (target ? Math.sin(state.pulse * 4) * 2 : 0), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .72; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, HIT_RADIUS, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  function drawPencil(owner) {
    const unit = state[owner], color = owner === 'player' ? COLORS.player : COLORS.ai, dark = owner === 'player' ? COLORS.playerDark : COLORS.aiDark;
    const moving = state.phase === 'networkMoving' && state.active === owner, length = 54;
    ctx.save(); ctx.translate(unit.pos.x, unit.pos.y); ctx.rotate(unit.angle); ctx.shadowColor = 'rgba(24,37,35,.22)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 5;
    ctx.fillStyle = dark; roundedRect(ctx, -length, -5, length - 8, 10, 2); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.fillStyle = color; ctx.fillRect(-length + 5, -3.2, length - 14, 3.2);
    ctx.fillStyle = '#dccba6'; ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(0, 0); ctx.lineTo(-8, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#283735'; ctx.beginPath(); ctx.moveTo(-2.8, -1.5); ctx.lineTo(0, 0); ctx.lineTo(-2.8, 1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d5d1c5'; ctx.fillRect(-length - 6, -5, 7, 10); ctx.fillStyle = owner === 'player' ? '#45c8c1' : '#f49a63'; ctx.fillRect(-length - 10, -5, 5, 10);
    if (moving) { ctx.globalAlpha = .16; ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-length - 18, 0); ctx.lineTo(-length - 42, 0); ctx.stroke(); }
    ctx.restore();
  }

  function drawAimGuide() {
    const start = state[net.side].pos, end = state.aimPoint;
    const dx = end.x - start.x, dy = end.y - start.y, len = Math.hypot(dx, dy);
    if (len < 2) return;
    const localAngle = Math.atan2(dy, dx);
    ctx.save(); ctx.strokeStyle = net.side === 'player' ? COLORS.player : COLORS.ai; ctx.fillStyle = ctx.strokeStyle; ctx.globalAlpha = .82; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.translate(end.x, end.y); ctx.rotate(localAngle); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-10, -5); ctx.lineTo(-7, 0); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill(); ctx.restore();

    const serverStart = localToServer(start), serverDx = dx / W * net.serverW, serverDy = dy / H * net.serverH;
    const angle = Math.atan2(serverDy, serverDx), power = state.aimPower;
    const centralFriction = paperFrictionForAngle(angle, 1);
    const centerPath = previewServerPath(serverStart, angle, power, centralFriction).map(serverToLocal);
    const shortPath = previewServerPath(serverStart, angle, power, centralFriction * 1.16).map(serverToLocal);
    const longPath = previewServerPath(serverStart, angle, power, centralFriction * .84).map(serverToLocal);
    ctx.save(); ctx.strokeStyle = net.side === 'player' ? COLORS.playerDark : COLORS.aiDark; ctx.fillStyle = ctx.strokeStyle; ctx.globalAlpha = .38; ctx.lineWidth = 1; ctx.setLineDash([3, 7]);
    pathPoints(centerPath); ctx.stroke(); ctx.setLineDash([]);
    const stop = centerPath.at(-1), shortStop = shortPath.at(-1), longStop = longPath.at(-1);
    ctx.globalAlpha = .18; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(shortStop.x, shortStop.y); ctx.lineTo(longStop.x, longStop.y); ctx.stroke();
    ctx.globalAlpha = .58; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(stop.x, stop.y, 5, 0, Math.PI * 2); ctx.stroke();
    [shortStop, longStop].forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); }); ctx.restore();
  }

  function previewServerPath(start, angle, power, friction) {
    let p = {...start};
    let speed = 180 + power * (MAX_SPEED - 180);
    let v = {x: Math.cos(angle) * speed, y: Math.sin(angle) * speed};
    const points = [{...p}], dt = .045;
    for (let i = 0; i < 75 && speed >= 18; i++) {
      p = {x: p.x + v.x * dt, y: p.y + v.y * dt};
      let boundary = false;
      if (p.x < EDGE) { p.x = EDGE; boundary = true; }
      if (p.x > net.serverW - EDGE) { p.x = net.serverW - EDGE; boundary = true; }
      if (p.y < EDGE + 22) { p.y = EDGE + 22; boundary = true; }
      if (p.y > net.serverH - EDGE - 44) { p.y = net.serverH - EDGE - 44; boundary = true; }
      points.push({...p});
      if (boundary) break;
      speed = Math.max(0, speed - friction * dt);
      v = {x: Math.cos(angle) * speed, y: Math.sin(angle) * speed};
    }
    return points;
  }

  function drawParticles() {
    state.particles.forEach(p => { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 2.2, 2.2); });
    ctx.globalAlpha = 1;
  }

  function spawnHitParticles(pos, owner) {
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2, s = 45 + Math.random() * 150;
      state.particles.push({x: pos.x, y: pos.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: .45 + Math.random() * .5, max: .95, color: owner === 'player' ? COLORS.player : COLORS.ai});
    }
  }

  function pathPoints(points) {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  }
  function pathAngle(points) { const a = points.at(-2), b = points.at(-1); return Math.atan2(b.y - a.y, b.x - a.x); }
  function roundedRect(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }
  function paperFrictionForAngle(angle, surface = 1) { return FRICTION * (1 + Math.sin(angle * 2 + .65) * .09) * surface; }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function normalizeCode(value) { return value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6); }

  document.getElementById('createRoomButton').addEventListener('click', createRoom);
  document.getElementById('joinRoomButton').addEventListener('click', joinRoom);
  document.getElementById('copyRoomButton').addEventListener('click', copyInvite);
  document.getElementById('playAgainButton').addEventListener('click', requestRestart);
  resetButton.addEventListener('click', requestRestart);
  roomInput.addEventListener('input', () => { roomInput.value = normalizeCode(roomInput.value); });
  roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { lastTime = performance.now(); });

  resize();
  const requestedRoom = normalizeCode(new URLSearchParams(location.search).get('room') || '');
  if (requestedRoom) roomInput.value = requestedRoom;
  requestAnimationFrame(frame);
})();
