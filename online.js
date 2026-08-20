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
  const resultClosest = document.getElementById('resultClosest');
  const resultPaper = document.getElementById('resultPaper');
  const resetButton = document.getElementById('resetButton');
  const toast = document.getElementById('toast');
  const paperName = document.getElementById('paperName');

  const COLORS = {
    player: '#0e9999', playerDark: '#086e73',
    ai: '#df6c31', aiDark: '#a9471e', ink: '#263e3d'
  };
  const MAX_DRAG = 92;
  const MIN_DRAG = 10;
  const AIM_WINDOW_MS = 500;
  const DRAG_POWER_WEIGHT = .7;
  const HOLD_POWER_WEIGHT = .3;
  const FRICTION = 940;
  const MAX_SPEED = 660;
  const CENTER_HIT_TOLERANCE = 2;
  const EDGE = 42;
  const APP_BASE = ['/game1', '/apps/games/pencil'].find(
    base => location.pathname === base || location.pathname.startsWith(`${base}/`)
  ) || '';
  const isTouchDevice = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  let W = 0, H = 0, dpr = 1, lastTime = performance.now();
  let toastTimer = null;
  let networkAvailable = null;
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
    presence: {player: false, ai: false},
    surface: {name: '—', friction: '—', factor: 1, range: '—'}
  };

  const state = {
    phase: 'lobby', round: 1, active: 'player', status: 'waiting', winner: null,
    player: {pos: {x: 0, y: 0}, angle: -.15},
    ai: {pos: {x: 0, y: 0}, angle: Math.PI},
    bases: {player: {x: 0, y: 0}, ai: {x: 0, y: 0}},
    trails: [], aiming: false, aimPoint: null, aimPower: 0,
    aimStart: null, aimVector: {x: 0, y: 0}, aimStartedAt: 0, aimDragDistance: 0, aimFrozen: false,
    pointerId: null, playback: null, pulse: 0, particles: [], lastShot: null, closestBySide: {player: null, ai: null},
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
    state.surface = snapshot.surface || state.surface;
    paperName.textContent = state.surface.name || '—';
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
    turnText.textContent = mine ? 'Draw your strike' : 'Waiting for rival input';
    instructionTitle.textContent = mine ? `${deviceVerb()} through the rival's center` : 'Your rival is choosing direction and impulse';
    instructionText.textContent = mine ? 'Release early or auto-launch at 0.5 seconds.' : 'Both players receive the same server-confirmed trace.';
    controlDock.classList.toggle('waiting', !mine);
    canvas.className = mine ? 'can-aim' : '';
    setPower(0);
  }

  function updatePresence(presence) {
    net.presence = presence || net.presence;
    leftPlayerMeta.textContent = net.side === 'player' ? 'YOU' : (net.presence.player ? 'RIVAL ONLINE' : 'WAITING');
    rightPlayerMeta.textContent = net.side === 'ai' ? 'YOU' : (net.presence.ai ? 'RIVAL ONLINE' : 'WAITING');
    if (net.presence.player && net.presence.ai) {
      networkState.textContent = 'LIVE';
      if (state.status === 'waiting') {
        waitingText.innerHTML = '<i></i> Both players connected. Sharpen up!';
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
        turnText.textContent = 'Rival disconnected — waiting to reconnect';
        canvas.className = '';
        controlDock.classList.add('waiting');
      }
    }
  }

  async function createRoom() {
    if (!canUseNetwork()) return;
    setLobbyBusy(true, 'Creating a room at the Cloudflare edge…');
    try {
      const response = await fetch(`${APP_BASE}/api/rooms`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({width: Math.round(W), height: Math.round(H)})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Room creation failed');
      saveCredentials(data.roomCode, data.token);
      connectSocket();
    } catch (error) {
      setLobbyBusy(false, `Could not create room: ${error.message}`);
    }
  }

  async function checkNetwork() {
    if (location.protocol === 'file:') {
      networkAvailable = false;
      networkState.textContent = 'LOCAL ONLY';
      lobbyStatus.textContent = 'Online play needs Cloudflare deployment or a local npm run dev server.';
      return;
    }
    networkState.textContent = 'CHECKING';
    try {
      const response = await fetch(`${APP_BASE}/api/health`, {cache: 'no-store'});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error('Match service did not respond');
      networkAvailable = true;
      networkState.textContent = 'READY';
      lobbyStatus.textContent = 'Match service ready — create a room or join a friend.';
      instructionTitle.textContent = 'Create a room or challenge a friend';
      instructionText.textContent = 'The server confirms every trace, paper condition, and center hit.';
    } catch {
      networkAvailable = false;
      networkState.textContent = 'OFFLINE';
      lobbyStatus.textContent = 'SERVER OFFLINE — Solo mode is still available.';
      instructionTitle.textContent = 'Online Arena is temporarily unavailable';
      instructionText.textContent = 'Use Solo practice while the match service reconnects.';
    }
  }

  async function joinRoom() {
    if (!canUseNetwork()) return;
    const code = normalizeCode(roomInput.value);
    if (code.length !== 6) {
      lobbyStatus.textContent = 'Enter a 6-character room code.';
      roomInput.focus();
      return;
    }
    setLobbyBusy(true, 'Joining the room…');
    try {
      const storedToken = localStorage.getItem(`pencil-duel:${code}`) || '';
      const response = await fetch(`${APP_BASE}/api/rooms/${code}/join`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({token: storedToken})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not join room');
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
        setLobbyBusy(false, event.reason || 'Room credentials expired. Please join again.');
        lobbyOverlay.hidden = false;
        return;
      }
      if (!net.intentionallyClosed && net.retries < 6) {
        net.retries += 1;
        net.reconnectTimer = setTimeout(() => connectSocket(true), Math.min(7000, 700 * 2 ** net.retries));
        showToast('Connection lost. Reconnecting…');
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
      showToast(message.message || 'The server rejected that action.');
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
    state.lastShot = {owner, closest: shot.closest, power: shot.power};
    state.closestBySide[owner] = shot.closest;
    state.trails.push(trail);
    state.active = owner;
    state.phase = 'networkMoving';
    state.playback = {path, trail, elapsed: 0, duration: Math.max(.18, shot.duration), pendingState, index: 0};
    turnBanner.classList.toggle('ai-turn', owner === 'ai');
    turnLabel.textContent = 'SERVER TRACE';
    turnText.textContent = owner === net.side ? 'Your pencil is in motion' : "Rival's pencil is in motion";
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
        haptic(pending.winner === net.side ? [16, 28, 20] : [32, 28, 32]);
        setTimeout(() => showResult(pending.winner), 360);
      } else {
        state.phase = state.active === net.side ? 'playerAim' : 'onlineWaiting';
        updateTurnUI();
        if (pb.trail.owner === net.side) showToast(shotFeedback(pb.trail.owner, state.lastShot.closest));
      }
    }
  }

  function sendShot(angle, power) {
    if (!net.connected || net.socket?.readyState !== WebSocket.OPEN) {
      showToast('Network connection is not ready.');
      state.phase = 'playerAim';
      return;
    }
    net.socket.send(JSON.stringify({type: 'shoot', angle, power}));
    state.phase = 'onlineWaiting';
    turnLabel.textContent = 'SUBMITTED';
    turnText.textContent = 'Server is resolving the slide';
    instructionTitle.textContent = 'Direction and impulse submitted';
    instructionText.textContent = 'The authoritative server gives both players one identical result.';
    controlDock.classList.add('waiting');
    canvas.className = '';
  }

  function requestRestart() {
    if (!net.connected || state.status !== 'finished') return;
    net.socket.send(JSON.stringify({type: 'restart'}));
    resetButton.disabled = true;
    showToast('Rematch requested.');
  }

  function showWaitingRoom() {
    lobbyOverlay.hidden = false;
    lobbyActions.hidden = true;
    roomReady.hidden = false;
    shareCode.textContent = net.roomCode;
    waitingText.innerHTML = '<i></i> Waiting for another player…';
    lobbyStatus.textContent = '';
    roomNumber.textContent = net.roomCode;
    networkState.textContent = 'WAITING';
    instructionTitle.textContent = 'Room ready — share the invite code';
    instructionText.textContent = `Paper: ${state.surface.name || 'server selected'}. The match begins when your rival connects.`;
  }

  function setLobbyBusy(busy, message = '') {
    document.getElementById('createRoomButton').disabled = busy;
    document.getElementById('joinRoomButton').disabled = busy;
    lobbyStatus.textContent = message;
  }

  function canUseNetwork() {
    if (networkAvailable === false) {
      lobbyStatus.textContent = 'SERVER OFFLINE — Solo mode is still available.';
      return false;
    }
    if (networkAvailable === null) {
      lobbyStatus.textContent = 'Checking the match service. Please try again in a moment.';
      return false;
    }
    return true;
  }

  function copyInvite() {
    const url = new URL(location.href);
    url.searchParams.set('room', net.roomCode);
    const text = url.toString();
    navigator.clipboard?.writeText(text).then(
      () => showToast('Invite link copied.'),
      () => window.prompt('Copy this invite link:', text)
    );
  }

  function showResult(winner) {
    const won = winner === net.side;
    resultOverlay.hidden = false;
    resultOverlay.classList.toggle('lost', !won);
    resultTitle.textContent = won ? 'YOU WIN' : 'OPPONENT WINS';
    const closest = Number.isFinite(state.closestBySide[net.side]) ? state.closestBySide[net.side] : null;
    resultText.textContent = won ? "Server confirmed: your line crossed the rival's center first." : (closest === null ? 'Server confirmed: the rival crossed your center first.' : `Server confirmed the rival's hit. Your latest trace missed by ${closest.toFixed(1)} px.`);
    resultRoom.textContent = net.roomCode;
    resultRounds.textContent = String(state.round).padStart(2, '0');
    resultClosest.textContent = closest === null ? '—' : `${closest.toFixed(1)} px`;
    resultPaper.textContent = state.surface.name || '—';
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
    state.aimStart = p; state.aimVector = {x: 0, y: 0}; state.aimStartedAt = performance.now(); state.aimDragDistance = 0; state.aimFrozen = false;
    state.aimPoint = {...unit.pos}; state.aimPower = 0;
    canvas.setPointerCapture(e.pointerId); canvas.className = 'is-aiming';
    instructionTitle.textContent = 'The pencil tip follows your exact gesture centerline';
    instructionText.textContent = 'Adjust for 0.5 seconds; the pencil launches when time expires.';
  }

  function pointerMove(e) {
    if (!state.aiming || e.pointerId !== state.pointerId) return;
    e.preventDefault();
    if (updateAimFromEvent(e)) commitOnlineAim();
  }

  function updateAimFromEvent(e) {
    if (updateAimPower()) return true;
    const samples = e.getCoalescedEvents?.();
    const p = pointFromEvent(samples?.length ? samples.at(-1) : e), origin = state[net.side].pos;
    const dx = p.x - state.aimStart.x, dy = p.y - state.aimStart.y, len = Math.hypot(dx, dy);
    const scale = len > MAX_DRAG ? MAX_DRAG / len : 1;
    state.aimVector = {x: dx, y: dy};
    state.aimPoint = {x: origin.x + dx * scale, y: origin.y + dy * scale};
    state.aimDragDistance = len;
    return updateAimPower();
  }

  function updateAimPower() {
    if (!state.aiming || state.aimFrozen) return state.aimFrozen;
    const elapsed = performance.now() - state.aimStartedAt;
    const dragPower = Math.min(1, state.aimDragDistance / MAX_DRAG);
    const holdPower = Math.min(1, elapsed / AIM_WINDOW_MS);
    state.aimPower = Math.min(1, dragPower * DRAG_POWER_WEIGHT + holdPower * HOLD_POWER_WEIGHT);
    setPower(state.aimPower);
    if (elapsed >= AIM_WINDOW_MS) {
      state.aimFrozen = true;
    }
    return state.aimFrozen;
  }

  function pointerUp(e) {
    if (!state.aiming || e.pointerId !== state.pointerId) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    updateAimFromEvent(e);
    updateAimPower();
    commitOnlineAim();
  }

  function commitOnlineAim() {
    if (!state.aiming) return;
    const power = state.aimPower;
    state.aiming = false;
    if (state.pointerId !== null && canvas.hasPointerCapture(state.pointerId)) {
      canvas.releasePointerCapture(state.pointerId);
    }
    const unit = state[net.side];
    const dx = state.aimVector.x, dy = state.aimVector.y;
    const len = Math.hypot(dx, dy);
    state.aimPoint = null;
    if (len < MIN_DRAG) {
      state.aimPower = 0; setPower(0); updateTurnUI(); return;
    }
    const serverDx = dx / W * net.serverW;
    const serverDy = dy / H * net.serverH;
    sendShot(Math.atan2(serverDy, serverDx), Math.max(.08, power));
    state.aimPower = 0; state.aimStart = null; state.aimVector = {x: 0, y: 0}; state.aimDragDistance = 0; state.aimFrozen = false; setPower(0);
  }

  function pointerCancel(e) {
    if (!state.aiming || e.pointerId !== state.pointerId) return;
    state.aiming = false;
    state.aimPoint = null;
    state.aimPower = 0;
    state.aimStart = null;
    state.aimVector = {x: 0, y: 0};
    state.aimDragDistance = 0;
    state.aimFrozen = false;
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
    if (state.aiming && updateAimPower()) commitOnlineAim();
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
    ctx.globalAlpha = target ? .42 + Math.sin(state.pulse * 5) * .12 : .28;
    ctx.lineWidth = .8; ctx.beginPath();
    ctx.moveTo(-8, 0); ctx.lineTo(-4, 0); ctx.moveTo(4, 0); ctx.lineTo(8, 0);
    ctx.moveTo(0, -8); ctx.lineTo(0, -4); ctx.moveTo(0, 4); ctx.lineTo(0, 8); ctx.stroke();
    ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(0, 0, CENTER_HIT_TOLERANCE, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  function drawPencil(owner) {
    const unit = state[owner], color = owner === 'player' ? COLORS.player : COLORS.ai, dark = owner === 'player' ? COLORS.playerDark : COLORS.aiDark;
    const highlight = owner === 'player' ? '#63e3d7' : '#ffb27e', eraser = owner === 'player' ? '#3bc8bd' : '#f28b58';
    const moving = state.phase === 'networkMoving' && state.active === owner, length = Math.min(58, Math.max(38, W * .105));
    ctx.save(); ctx.translate(unit.pos.x, unit.pos.y); ctx.rotate(unit.angle);
    if (moving) {
      const blur = ctx.createLinearGradient(-length - 56, 0, -length, 0); blur.addColorStop(0, 'rgba(255,255,255,0)'); blur.addColorStop(1, owner === 'player' ? 'rgba(15,156,156,.22)' : 'rgba(230,119,55,.22)');
      ctx.strokeStyle = blur; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-length - 54, 0); ctx.lineTo(-length - 8, 0); ctx.stroke();
    }
    ctx.shadowColor = 'rgba(12,30,29,.34)'; ctx.shadowBlur = 13; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 7;
    ctx.fillStyle = dark; roundedRect(ctx, -length, -6, length - 8, 12, 2.5); ctx.fill(); ctx.shadowColor = 'transparent';
    const body = ctx.createLinearGradient(0, -6, 0, 6); body.addColorStop(0, dark); body.addColorStop(.18, color); body.addColorStop(.46, highlight); body.addColorStop(.58, color); body.addColorStop(1, dark);
    ctx.fillStyle = body; roundedRect(ctx, -length + 1, -5.4, length - 9, 10.8, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.moveTo(-length + 5, -4.4); ctx.lineTo(-9, -4.4); ctx.lineTo(-9, -2.2); ctx.lineTo(-length + 5, -1.7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.beginPath(); ctx.moveTo(-length + 4, 2.4); ctx.lineTo(-9, 2); ctx.lineTo(-9, 5); ctx.lineTo(-length + 4, 5); ctx.closePath(); ctx.fill();
    const wood = ctx.createLinearGradient(-8, 0, 0, 0); wood.addColorStop(0, '#cda96f'); wood.addColorStop(.48, '#f1dbaf'); wood.addColorStop(1, '#b58d56');
    ctx.fillStyle = wood; ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(0, 0); ctx.lineTo(-8, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(91,62,31,.2)'; ctx.lineWidth = .65; ctx.beginPath(); ctx.moveTo(-8, -3.4); ctx.lineTo(-1.8, 0); ctx.lineTo(-8, 3.4); ctx.stroke();
    ctx.fillStyle = '#283735'; ctx.beginPath(); ctx.moveTo(-2.8, -1.65); ctx.lineTo(.6, 0); ctx.lineTo(-2.8, 1.65); ctx.closePath(); ctx.fill();
    const metal = ctx.createLinearGradient(0, -6, 0, 6); metal.addColorStop(0, '#8f9997'); metal.addColorStop(.28, '#f1f2ed'); metal.addColorStop(.5, '#aeb7b4'); metal.addColorStop(.72, '#fafaf5'); metal.addColorStop(1, '#727d7a');
    ctx.fillStyle = metal; ctx.fillRect(-length - 7, -6, 8, 12); ctx.strokeStyle = 'rgba(57,69,66,.28)'; ctx.lineWidth = .6;
    [-length - 5, -length - 2].forEach(x => { ctx.beginPath(); ctx.moveTo(x, -5.5); ctx.lineTo(x, 5.5); ctx.stroke(); });
    ctx.fillStyle = eraser; roundedRect(ctx, -length - 14, -5.7, 7, 11.4, 2.5); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.28)'; roundedRect(ctx, -length - 13, -4.5, 2, 8, 1); ctx.fill();
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
    const centralFriction = paperFrictionForAngle(angle, net.surface.factor || 1);
    const centerPath = previewServerPath(serverStart, angle, power, centralFriction).map(serverToLocal);
    ctx.save(); ctx.strokeStyle = net.side === 'player' ? COLORS.playerDark : COLORS.aiDark; ctx.fillStyle = ctx.strokeStyle; ctx.globalAlpha = .38; ctx.lineWidth = 1; ctx.setLineDash([3, 7]);
    pathPoints(centerPath); ctx.stroke(); ctx.setLineDash([]);
    const stop = centerPath.at(-1);
    ctx.globalAlpha = .58; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(stop.x, stop.y, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(stop.x, stop.y, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
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
  function shotFeedback(owner, closest) {
    if (!Number.isFinite(closest)) return 'TRACE COMPLETE';
    if (closest <= 8) return `GREAT — only ${closest.toFixed(1)} px from center`;
    if (closest <= 20) return `CLOSE — only ${closest.toFixed(1)} px from center`;
    return `MISS BY ${closest.toFixed(1)} px`;
  }
  function deviceVerb() { return isTouchDevice ? 'Touch, drag and flick' : 'Hold and flick'; }
  function haptic(pattern) { if (isTouchDevice && navigator.vibrate) navigator.vibrate(pattern); }
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
  checkNetwork();
  requestAnimationFrame(frame);
})();
