(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const board = document.getElementById('boardWrap');
  const roundNumber = document.getElementById('roundNumber');
  const turnBanner = document.getElementById('turnBanner');
  const aiMode = document.getElementById('aiMode');
  const instructionTitle = document.getElementById('instructionTitle');
  const instructionText = document.getElementById('instructionText');
  const powerValue = document.getElementById('powerValue');
  const powerFill = document.getElementById('powerFill');
  const controlDock = document.getElementById('controlDock');
  const resultOverlay = document.getElementById('resultOverlay');
  const resultTitle = document.getElementById('resultTitle');
  const resultText = document.getElementById('resultText');
  const resultRounds = document.getElementById('resultRounds');
  const resultDistance = document.getElementById('resultDistance');

  const COLORS = {
    player: '#0e9999', playerDark: '#086e73',
    ai: '#df6c31', aiDark: '#a9471e', ink: '#263e3d', paper: '#f1eee3'
  };
  const MAX_DRAG = 92;
  const MIN_DRAG = 10;
  const AIM_WINDOW_MS = 300;
  const DRAG_POWER_WEIGHT = .7;
  const HOLD_POWER_WEIGHT = .3;
  const FRICTION = 940;
  const MAX_SPEED = 660;
  const CENTER_HIT_TOLERANCE = 2;
  const EDGE = 42;
  const audio = { context: null, scratch: null, gain: null };

  let W = 0, H = 0, dpr = 1, lastTime = performance.now();
  let state;
  let rafId = null;

  function makeState() {
    return {
      phase: 'playerAim',
      round: 1,
      active: 'player',
      player: { pos: {x: W * .15, y: H * .68}, vel: {x: 0, y: 0}, angle: -.15, distance: 0, lastMove: {x: 0, y: 0} },
      ai: { pos: {x: W * .85, y: H * .32}, vel: {x: 0, y: 0}, angle: Math.PI, distance: 0, lastMove: {x: 0, y: 0} },
      bases: { player: {x: W * .11, y: H * .68}, ai: {x: W * .89, y: H * .32} },
      trails: [],
      currentTrail: null,
      aiming: false,
      aimPoint: null,
      aimPower: 0,
      aimStart: null,
      aimStartedAt: 0,
      aimDragDistance: 0,
      aimFrozen: false,
      pointerId: null,
      winner: null,
      particles: [],
      pulse: 0,
      shake: 0,
      aiTimer: null
    };
  }

  function resize() {
    const rect = board.getBoundingClientRect();
    const oldW = W || rect.width;
    const oldH = H || rect.height;
    W = Math.max(320, rect.width);
    H = Math.max(300, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state && oldW && oldH) {
      const sx = W / oldW, sy = H / oldH;
      ['player', 'ai'].forEach(k => { state[k].pos.x *= sx; state[k].pos.y *= sy; });
      Object.values(state.bases).forEach(p => { p.x *= sx; p.y *= sy; });
      state.trails.forEach(t => t.points.forEach(p => { p.x *= sx; p.y *= sy; }));
    }
  }

  function resetGame() {
    if (state?.aiTimer) clearTimeout(state.aiTimer);
    state = makeState();
    resultOverlay.hidden = true;
    resultOverlay.classList.remove('lost');
    updateUI('player');
    canvas.className = 'can-aim';
    lastTime = performance.now();
  }

  function updateUI(turn) {
    roundNumber.textContent = String(state.round).padStart(2, '0');
    turnBanner.querySelector('.turn-index').textContent = String(state.round).padStart(2, '0');
    if (turn === 'player') {
      turnBanner.classList.remove('ai-turn');
      turnBanner.querySelector('small').textContent = 'YOUR MOVE';
      turnBanner.querySelector('strong').textContent = '轮到你了';
      instructionTitle.textContent = '按住鼠标左键，朝出手方向滑动';
      instructionText.textContent = '在 0.3 秒内滑动；提前松开或到时后都会立即出手。';
      controlDock.classList.remove('waiting');
    } else {
      turnBanner.classList.add('ai-turn');
      turnBanner.querySelector('small').textContent = 'AI MOVE';
      turnBanner.querySelector('strong').textContent = '电脑正在计算轨迹';
      instructionTitle.textContent = '电脑正在预判你的落点';
      instructionText.textContent = '它会尝试直接截击，同时规避危险落点。';
      controlDock.classList.add('waiting');
    }
    setPower(0);
  }

  function setPower(value) {
    const percent = Math.round(value * 100);
    powerValue.textContent = `${percent}%`;
    powerFill.style.width = `${percent}%`;
    powerFill.style.background = value > .78 ? '#ff9a5e' : '#50d3ca';
  }

  function pointFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function pointerDown(e) {
    if (state.phase !== 'playerAim') return;
    if (state.aiming) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = pointFromEvent(e);
    if (distance(p, state.player.pos) > 60) return;
    e.preventDefault();
    initAudio();
    state.aiming = true;
    state.pointerId = e.pointerId;
    state.aimStart = p;
    state.aimStartedAt = performance.now();
    state.aimDragDistance = 0;
    state.aimFrozen = false;
    state.aimPoint = {...state.player.pos};
    state.aimPower = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.className = 'is-aiming';
    instructionTitle.textContent = '滑动决定方向，距离 + 时长决定力度';
    instructionText.textContent = '前 0.3 秒内可调整；计时结束时铅笔会自动滑出。';
  }

  function pointerMove(e) {
    if (!state.aiming || e.pointerId !== state.pointerId) return;
    e.preventDefault();
    if (updateAimFromEvent(e)) commitPlayerAim();
  }

  function updateAimFromEvent(e) {
    if (updateAimPower()) return true;
    const p = pointFromEvent(e);
    const origin = state.player.pos;
    const dx = p.x - state.aimStart.x, dy = p.y - state.aimStart.y;
    const len = Math.hypot(dx, dy);
    const scale = len > MAX_DRAG ? MAX_DRAG / len : 1;
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
    commitPlayerAim();
  }

  function commitPlayerAim() {
    if (!state.aiming) return;
    const power = state.aimPower;
    state.aiming = false;
    if (state.pointerId !== null && canvas.hasPointerCapture(state.pointerId)) {
      canvas.releasePointerCapture(state.pointerId);
    }
    canvas.className = '';
    const dx = state.aimPoint.x - state.player.pos.x;
    const dy = state.aimPoint.y - state.player.pos.y;
    const len = Math.hypot(dx, dy);
    if (len < MIN_DRAG) {
      state.aimPoint = null;
      state.aimPower = 0;
      canvas.className = 'can-aim';
      updateUI('player');
      return;
    }
    const speed = 180 + Math.max(.08, power) * (MAX_SPEED - 180);
    launch('player', {x: dx / len * speed, y: dy / len * speed});
  }

  function pointerCancel(e) {
    if (!state.aiming || e.pointerId !== state.pointerId) return;
    state.aiming = false;
    state.aimPoint = null;
    state.aimPower = 0;
    state.aimStart = null;
    state.aimDragDistance = 0;
    state.aimFrozen = false;
    setPower(0);
    canvas.className = state.phase === 'playerAim' ? 'can-aim' : '';
    updateUI('player');
  }

  function launch(owner, velocity) {
    const unit = state[owner];
    const shotAngle = Math.atan2(velocity.y, velocity.x);
    const randomSurface = .84 + Math.random() * .32;
    state.active = owner;
    state.phase = 'moving';
    unit.vel = {...velocity};
    unit.angle = shotAngle;
    unit.moveFriction = paperFrictionForAngle(shotAngle, randomSurface);
    unit.startPos = {...unit.pos};
    state.currentTrail = {
      owner,
      points: [{...unit.pos}],
      seed: Math.random() * 1000,
      distance: 0
    };
    state.trails.push(state.currentTrail);
    state.aimPoint = null;
    state.aimPower = 0;
    state.aimStart = null;
    state.aimDragDistance = 0;
    state.aimFrozen = false;
    setPower(0);
    startScratch();
  }

  function update(dt) {
    state.pulse += dt;
    if (state.aiming && updateAimPower()) commitPlayerAim();
    if (state.phase === 'moving') updateMovement(dt);
    state.particles.forEach(p => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt; });
    state.particles = state.particles.filter(p => p.life > 0);
    state.shake = Math.max(0, state.shake - dt * 16);
  }

  function updateMovement(dt) {
    const owner = state.active;
    const unit = state[owner];
    let speed = Math.hypot(unit.vel.x, unit.vel.y);
    const steps = Math.max(1, Math.ceil(speed * dt / 5));
    const stepDt = dt / steps;
    const target = state[owner === 'player' ? 'ai' : 'player'];
    for (let i = 0; i < steps; i++) {
      const old = {...unit.pos};
      unit.pos.x += unit.vel.x * stepDt;
      unit.pos.y += unit.vel.y * stepDt;
      let hitBoundary = false;
      if (unit.pos.x < EDGE) { unit.pos.x = EDGE; hitBoundary = true; }
      if (unit.pos.x > W - EDGE) { unit.pos.x = W - EDGE; hitBoundary = true; }
      if (unit.pos.y < EDGE + 22) { unit.pos.y = EDGE + 22; hitBoundary = true; }
      if (unit.pos.y > H - EDGE - 44) { unit.pos.y = H - EDGE - 44; hitBoundary = true; }
      const moved = distance(old, unit.pos);
      state.currentTrail.distance += moved;
      unit.distance += moved;
      if (moved > 1.2) state.currentTrail.points.push({...unit.pos});
      unit.angle = Math.atan2(unit.vel.y, unit.vel.x);
      if (segmentDistance(old, unit.pos, target.pos) <= CENTER_HIT_TOLERANCE) {
        state.currentTrail.points.push({...unit.pos});
        endGame(owner);
        return;
      }
      speed = hitBoundary ? 0 : Math.max(0, Math.hypot(unit.vel.x, unit.vel.y) - unit.moveFriction * stepDt);
      const a = Math.atan2(unit.vel.y, unit.vel.x);
      unit.vel.x = Math.cos(a) * speed;
      unit.vel.y = Math.sin(a) * speed;
    }
    setScratchLevel(Math.min(1, speed / MAX_SPEED));
    if (speed < 18) finishMove();
  }

  function finishMove() {
    stopScratch();
    const owner = state.active;
    const unit = state[owner];
    unit.vel = {x: 0, y: 0};
    unit.lastMove = {x: unit.pos.x - unit.startPos.x, y: unit.pos.y - unit.startPos.y};
    state.currentTrail = null;
    playTick(owner === 'player' ? 330 : 240, .06);
    if (owner === 'player') {
      state.phase = 'aiThinking';
      updateUI('ai');
      aiMode.textContent = 'SCANNING';
      state.aiTimer = setTimeout(takeAiTurn, 720);
    } else {
      state.round += 1;
      state.phase = 'playerAim';
      state.active = 'player';
      canvas.className = 'can-aim';
      aiMode.textContent = 'HUNTER';
      updateUI('player');
    }
  }

  function takeAiTurn() {
    if (state.phase !== 'aiThinking') return;
    const choice = chooseAiShot();
    aiMode.textContent = choice.direct ? 'LOCKED' : choice.mode;
    turnBanner.querySelector('strong').textContent = choice.direct ? '电脑锁定了截击线' : '电脑开始滑行';
    launch('ai', choice.velocity);
  }

  function chooseAiShot() {
    const start = state.ai.pos;
    const target = state.player.pos;
    const lm = state.player.lastMove;
    const predicted = {
      x: clamp(target.x + lm.x * .52, EDGE, W - EDGE),
      y: clamp(target.y + lm.y * .52, EDGE + 22, H - EDGE - 44)
    };
    const baseAngle = Math.atan2(target.y - start.y, target.x - start.x);
    const predictedAngle = Math.atan2(predicted.y - start.y, predicted.x - start.x);
    const candidates = [];
    const powers = [.46, .58, .70, .82, .94, 1];
    for (const center of [baseAngle, predictedAngle]) {
      for (let n = -10; n <= 10; n++) {
        for (const power of powers) candidates.push({angle: center + n * .035, power});
      }
    }
    for (let n = 0; n < 72; n++) {
      const angle = n / 72 * Math.PI * 2;
      for (const power of [.5, .68, .86, 1]) candidates.push({angle, power});
    }
    let best = null;
    for (const c of candidates) {
      const speed = 180 + c.power * (MAX_SPEED - 180);
      const sim = simulateShot(start, {x: Math.cos(c.angle) * speed, y: Math.sin(c.angle) * speed}, target, predicted);
      const playerReach = distance(sim.end, target);
      const edgeSpace = Math.min(sim.end.x - EDGE, W - EDGE - sim.end.x, sim.end.y - EDGE, H - EDGE - sim.end.y);
      const danger = Math.max(0, 470 - playerReach) * .22 + (playerReach < 85 ? 240 : 0);
      const edgePenalty = Math.max(0, 64 - edgeSpace) * 1.7;
      const directBonus = sim.hit ? -100000 + sim.time * 120 : 0;
      const score = directBonus + sim.minTarget * 8.5 + sim.minPredicted * 1.35 + danger + edgePenalty + c.power * 8;
      if (!best || score < best.score) best = {...c, ...sim, score};
    }
    const speed = 180 + best.power * (MAX_SPEED - 180);
    // The AI plans geometrically, but executes like a real hand: early shots have
    // a little more angular error and become steadier as the duel continues.
    const directError = Math.max(.032, .072 - state.round * .004);
    const aimError = best.hit
      ? (Math.random() * 2 - 1) * directError
      : (Math.random() * 2 - 1) * .026;
    const shotAngle = best.angle + aimError;
    return {
      velocity: {x: Math.cos(shotAngle) * speed, y: Math.sin(shotAngle) * speed},
      direct: best.hit,
      mode: best.minPredicted < best.minTarget * .9 ? 'PREDICT' : (distance(best.end, target) > 430 ? 'EVADE' : 'CHASE')
    };
  }

  function simulateShot(start, velocity, target, predicted) {
    let p = {...start}, v = {...velocity}, time = 0;
    let minTarget = Infinity, minPredicted = Infinity, hit = false;
    const dt = .025;
    const simulatedFriction = paperFrictionForAngle(Math.atan2(velocity.y, velocity.x), 1);
    while (Math.hypot(v.x, v.y) >= 18 && time < 3.4) {
      const old = {...p};
      p.x += v.x * dt; p.y += v.y * dt;
      let hitBoundary = false;
      if (p.x < EDGE) { p.x = EDGE; hitBoundary = true; }
      if (p.x > W - EDGE) { p.x = W - EDGE; hitBoundary = true; }
      if (p.y < EDGE + 22) { p.y = EDGE + 22; hitBoundary = true; }
      if (p.y > H - EDGE - 44) { p.y = H - EDGE - 44; hitBoundary = true; }
      const dTarget = segmentDistance(old, p, target);
      minTarget = Math.min(minTarget, dTarget);
      minPredicted = Math.min(minPredicted, segmentDistance(old, p, predicted));
      if (dTarget <= CENTER_HIT_TOLERANCE) { hit = true; break; }
      if (hitBoundary) break;
      const speed = Math.max(0, Math.hypot(v.x, v.y) - simulatedFriction * dt);
      const a = Math.atan2(v.y, v.x);
      v = {x: Math.cos(a) * speed, y: Math.sin(a) * speed};
      time += dt;
    }
    return {end: p, minTarget, minPredicted, hit, time};
  }

  function endGame(winner) {
    state.phase = 'gameOver';
    state.winner = winner;
    stopScratch();
    canvas.className = '';
    state.shake = 8;
    spawnHitParticles(state[winner === 'player' ? 'ai' : 'player'].pos, winner);
    playHit(winner === 'player');
    setTimeout(() => {
      resultOverlay.hidden = false;
      resultOverlay.classList.toggle('lost', winner === 'ai');
      resultTitle.textContent = winner === 'player' ? 'PLAYER WINS' : 'COMPUTER WINS';
      resultText.textContent = winner === 'player'
        ? '你的铅笔轨迹截中了电脑的当前位置。'
        : '电脑的铅笔轨迹先一步截中了你。';
      resultRounds.textContent = String(state.round).padStart(2, '0');
      resultDistance.textContent = `${Math.round(state.player.distance)} px`;
    }, 620);
  }

  function spawnHitParticles(pos, owner) {
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2, s = 45 + Math.random() * 150;
      state.particles.push({x: pos.x, y: pos.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: .45 + Math.random() * .5, max: .95, color: owner === 'player' ? COLORS.player : COLORS.ai});
    }
  }

  function frame(now) {
    const dt = Math.min(.033, (now - lastTime) / 1000 || .016);
    lastTime = now;
    update(dt);
    draw();
    rafId = requestAnimationFrame(frame);
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (state.shake > 0) ctx.translate((Math.random() - .5) * state.shake, (Math.random() - .5) * state.shake);
    drawBoundary();
    drawBases();
    state.trails.forEach(drawTrail);
    if (state.aiming && state.aimPoint) drawAimGuide();
    drawCurrentMarker('player');
    drawCurrentMarker('ai');
    drawPencil('player');
    drawPencil('ai');
    drawParticles();
    ctx.restore();
  }

  function drawBoundary() {
    ctx.save();
    ctx.strokeStyle = 'rgba(25,59,57,.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    ctx.strokeRect(EDGE - 12, EDGE + 10, W - (EDGE - 12) * 2, H - (EDGE + 10) - (EDGE + 32));
    ctx.setLineDash([]);
    cornerMark(EDGE - 12, EDGE + 10, 1, 1);
    cornerMark(W - EDGE + 12, EDGE + 10, -1, 1);
    cornerMark(EDGE - 12, H - EDGE - 32, 1, -1);
    cornerMark(W - EDGE + 12, H - EDGE - 32, -1, -1);
    ctx.restore();
  }

  function cornerMark(x, y, sx, sy) {
    ctx.beginPath(); ctx.moveTo(x, y + sy * 16); ctx.lineTo(x, y); ctx.lineTo(x + sx * 16, y); ctx.stroke();
  }

  function drawBases() {
    drawBase(state.bases.player, 'PLAYER', COLORS.player, -1);
    drawBase(state.bases.ai, 'AI', COLORS.ai, 1);
  }

  function drawBase(p, label, color, direction) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = .31;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, 31, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = .11;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .56;
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 8px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.letterSpacing = '1px';
    ctx.fillText(`${label} BASE`, 0, direction < 0 ? 48 : -43);
    ctx.restore();
  }

  function drawTrail(trail) {
    if (trail.points.length < 2) return;
    const color = trail.owner === 'player' ? COLORS.player : COLORS.ai;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const last = trail.points.length - 1;
    for (let i = 1; i <= last; i++) {
      const a = trail.points[i - 1], b = trail.points[i];
      const t = (i - 1) / Math.max(1, last);
      const fade = 1 - t * .74;

      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color; ctx.globalAlpha = .24 * fade; ctx.lineWidth = 4.1 - t * 1.4; ctx.stroke();

      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = '#263b3a'; ctx.globalAlpha = .75 * fade; ctx.lineWidth = 1.65 - t * .55; ctx.stroke();

      const j1x = Math.sin((i - 1) * 2.37 + trail.seed) * .72;
      const j1y = Math.cos((i - 1) * 1.91 + trail.seed) * .58;
      const j2x = Math.sin(i * 2.37 + trail.seed) * .72;
      const j2y = Math.cos(i * 1.91 + trail.seed) * .58;
      ctx.beginPath(); ctx.moveTo(a.x + j1x, a.y + j1y); ctx.lineTo(b.x + j2x, b.y + j2y);
      ctx.strokeStyle = '#172d2c'; ctx.globalAlpha = .24 * fade; ctx.lineWidth = .5; ctx.stroke();
    }
    const start = trail.points[0];
    ctx.globalAlpha = .48; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(start.x, start.y, 2.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function pathPoints(points) {
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  }

  function drawCurrentMarker(owner) {
    const unit = state[owner];
    const color = owner === 'player' ? COLORS.player : COLORS.ai;
    const activeTarget = state.phase !== 'gameOver' && ((state.active === 'player' && owner === 'ai') || (state.active === 'ai' && owner === 'player'));
    ctx.save(); ctx.translate(unit.pos.x, unit.pos.y);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.globalAlpha = activeTarget ? .42 + Math.sin(state.pulse * 5) * .12 : .28;
    ctx.lineWidth = .8;
    ctx.beginPath();
    ctx.moveTo(-8, 0); ctx.lineTo(-4, 0); ctx.moveTo(4, 0); ctx.lineTo(8, 0);
    ctx.moveTo(0, -8); ctx.lineTo(0, -4); ctx.moveTo(0, 4); ctx.lineTo(0, 8);
    ctx.stroke();
    ctx.globalAlpha = .9;
    ctx.beginPath(); ctx.arc(0, 0, CENTER_HIT_TOLERANCE, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawPencil(owner) {
    const unit = state[owner];
    const moving = state.phase === 'moving' && state.active === owner;
    const color = owner === 'player' ? COLORS.player : COLORS.ai;
    const dark = owner === 'player' ? COLORS.playerDark : COLORS.aiDark;
    const length = 54;
    ctx.save();
    ctx.translate(unit.pos.x, unit.pos.y);
    ctx.rotate(unit.angle);
    ctx.shadowColor = 'rgba(24,37,35,.22)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 5;
    ctx.fillStyle = dark;
    roundRect(ctx, -length, -5, length - 8, 10, 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = color;
    ctx.fillRect(-length + 5, -3.2, length - 14, 3.2);
    ctx.fillStyle = '#dccba6';
    ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(0, 0); ctx.lineTo(-8, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#283735';
    ctx.beginPath(); ctx.moveTo(-2.8, -1.5); ctx.lineTo(0, 0); ctx.lineTo(-2.8, 1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d5d1c5'; ctx.fillRect(-length - 6, -5, 7, 10);
    ctx.fillStyle = owner === 'player' ? '#45c8c1' : '#f49a63'; ctx.fillRect(-length - 10, -5, 5, 10);
    if (moving) {
      ctx.globalAlpha = .16; ctx.strokeStyle = color; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(-length - 18, 0); ctx.lineTo(-length - 48, 0); ctx.stroke();
    }
    ctx.restore();
  }

  function drawAimGuide() {
    const start = state.player.pos;
    const end = state.aimPoint;
    const dx = end.x - start.x, dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.strokeStyle = COLORS.player; ctx.fillStyle = COLORS.player;
    ctx.globalAlpha = .82; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.translate(end.x, end.y); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-10, -5); ctx.lineTo(-7, 0); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
    ctx.restore();

    const speed = 180 + state.aimPower * (MAX_SPEED - 180);
    const centralFriction = paperFrictionForAngle(angle, 1);
    const shotVelocity = {x: Math.cos(angle) * speed, y: Math.sin(angle) * speed};
    const preview = previewPath(start, shotVelocity, centralFriction);
    const shortPreview = previewPath(start, shotVelocity, centralFriction * 1.16);
    const longPreview = previewPath(start, shotVelocity, centralFriction * .84);
    ctx.save(); ctx.strokeStyle = COLORS.playerDark; ctx.fillStyle = COLORS.playerDark; ctx.globalAlpha = .38; ctx.lineWidth = 1; ctx.setLineDash([3, 7]);
    pathPoints(preview); ctx.stroke(); ctx.setLineDash([]);
    const stop = preview[preview.length - 1];
    const shortStop = shortPreview[shortPreview.length - 1];
    const longStop = longPreview[longPreview.length - 1];
    ctx.globalAlpha = .18; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(shortStop.x, shortStop.y); ctx.lineTo(longStop.x, longStop.y); ctx.stroke();
    ctx.globalAlpha = .58; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(stop.x, stop.y, 5, 0, Math.PI * 2); ctx.stroke();
    for (const edgeStop of [shortStop, longStop]) {
      ctx.beginPath(); ctx.arc(edgeStop.x, edgeStop.y, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function previewPath(start, velocity, previewFriction = FRICTION) {
    let p = {...start}, v = {...velocity};
    const pts = [{...p}], dt = .045;
    for (let i = 0; i < 75 && Math.hypot(v.x, v.y) >= 18; i++) {
      p = {x: p.x + v.x * dt, y: p.y + v.y * dt};
      let hitBoundary = false;
      if (p.x < EDGE) { p.x = EDGE; hitBoundary = true; }
      if (p.x > W - EDGE) { p.x = W - EDGE; hitBoundary = true; }
      if (p.y < EDGE + 22) { p.y = EDGE + 22; hitBoundary = true; }
      if (p.y > H - EDGE - 44) { p.y = H - EDGE - 44; hitBoundary = true; }
      pts.push({...p});
      if (hitBoundary) break;
      const s = Math.max(0, Math.hypot(v.x, v.y) - previewFriction * dt), a = Math.atan2(v.y, v.x);
      v = {x: Math.cos(a) * s, y: Math.sin(a) * s};
    }
    return pts;
  }

  function drawParticles() {
    state.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 2.2, 2.2);
    });
    ctx.globalAlpha = 1;
  }

  function initAudio() {
    if (audio.context) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio.context = new AC();
    const buffer = audio.context.createBuffer(1, audio.context.sampleRate * 1.4, audio.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() < .04 ? 1 : .32);
    audio.scratch = audio.context.createBufferSource();
    audio.scratch.buffer = buffer; audio.scratch.loop = true;
    const filter = audio.context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1300; filter.Q.value = .7;
    audio.gain = audio.context.createGain(); audio.gain.gain.value = 0;
    audio.scratch.connect(filter).connect(audio.gain).connect(audio.context.destination);
    audio.scratch.start();
  }

  function startScratch() { if (audio.context?.state === 'suspended') audio.context.resume(); setScratchLevel(.35); }
  function setScratchLevel(level) { if (audio.gain) audio.gain.gain.setTargetAtTime(level * .045, audio.context.currentTime, .025); }
  function stopScratch() { if (audio.gain) audio.gain.gain.setTargetAtTime(0, audio.context.currentTime, .04); }
  function playTick(freq, duration) {
    if (!audio.context) return;
    const osc = audio.context.createOscillator(), gain = audio.context.createGain();
    osc.type = 'triangle'; osc.frequency.value = freq; gain.gain.setValueAtTime(.045, audio.context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.context.currentTime + duration);
    osc.connect(gain).connect(audio.context.destination); osc.start(); osc.stop(audio.context.currentTime + duration);
  }
  function playHit(won) {
    if (!audio.context) return;
    [0, .08, .16].forEach((delay, i) => {
      const osc = audio.context.createOscillator(), gain = audio.context.createGain();
      osc.type = i === 0 ? 'square' : 'triangle'; osc.frequency.value = (won ? 330 : 180) * (i + 1);
      gain.gain.setValueAtTime(.06, audio.context.currentTime + delay); gain.gain.exponentialRampToValueAtTime(.001, audio.context.currentTime + delay + .18);
      osc.connect(gain).connect(audio.context.destination); osc.start(audio.context.currentTime + delay); osc.stop(audio.context.currentTime + delay + .2);
    });
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h);
  }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function paperFrictionForAngle(angle, surfaceFactor = 1) {
    const grainDirection = 1 + Math.sin(angle * 2 + .65) * .09;
    return FRICTION * grainDirection * surfaceFactor;
  }
  function segmentDistance(a, b, p) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return distance(a, p);
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  document.getElementById('resetButton').addEventListener('click', resetGame);
  document.getElementById('playAgainButton').addEventListener('click', resetGame);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { lastTime = performance.now(); });

  resize();
  resetGame();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(frame);
})();
