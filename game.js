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
  const resultClosest = document.getElementById('resultClosest');
  const resultAccuracy = document.getElementById('resultAccuracy');
  const resultPower = document.getElementById('resultPower');
  const resultStreak = document.getElementById('resultStreak');
  const harderButton = document.getElementById('harderButton');
  const tutorialOverlay = document.getElementById('tutorialOverlay');
  const paperName = document.getElementById('paperName');
  const frictionValue = document.getElementById('frictionValue');
  const aimLimitValue = document.getElementById('aimLimitValue');
  const rangeValue = document.getElementById('rangeValue');
  const telemetry = document.querySelector('.telemetry');
  const telemetryToggle = document.getElementById('telemetryToggle');
  const aiSubtitle = document.getElementById('aiSubtitle');
  const rankValue = document.getElementById('rankValue');
  const hudPanels = [
    document.querySelector('.paper-title'),
    turnBanner,
    telemetry,
    document.querySelector('.legend'),
    controlDock
  ].filter(Boolean);

  const COLORS = {
    player: '#0e9999', playerDark: '#086e73',
    ai: '#df6c31', aiDark: '#a9471e', ink: '#263e3d', paper: '#f1eee3'
  };
  const MAX_DRAG = 92;
  const MIN_DRAG = 10;
  const DRAG_POWER_WEIGHT = .7;
  const HOLD_POWER_WEIGHT = .3;
  const FRICTION = 940;
  const MAX_SPEED = 660;
  const CENTER_HIT_TOLERANCE = 2;
  const EDGE = 42;
  const audio = { context: null, scratch: null, gain: null };
  const MODE_KEY = 'pencil-duel:mode';
  const PROGRESS_KEY = 'pencil-duel:progress';
  const TUTORIAL_KEY = 'pencil-duel:tutorial-seen';
  const MODES = {
    easy: {label: 'EASY', aimWindow: 800, profile: 'ROOKIE', aiError: .14, powers: [.40, .52, .64, .76, .88]},
    normal: {label: 'NORMAL', aimWindow: 500, profile: 'HUNTER', aiError: .068, powers: [.46, .58, .70, .82, .94, 1]},
    expert: {label: 'EXPERT', aimWindow: 300, profile: 'SNIPER', aiError: .024, powers: [.54, .66, .78, .90, 1]}
  };
  const SURFACES = [
    {name: 'SMOOTH', friction: 'LOW', factor: .92, range: 'STABLE'},
    {name: 'GRAIN', friction: 'MEDIUM', factor: 1, range: 'ANGLE GRAIN'},
    {name: 'ROUGH', friction: 'HIGH', factor: 1.10, range: 'ANGLE GRAIN'}
  ];
  const isTouchDevice = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  let W = 0, H = 0, dpr = 1, lastTime = performance.now();
  let state;
  let rafId = null;

  function makeState() {
    const savedMode = localStorage.getItem(MODE_KEY);
    return {
      phase: 'playerAim',
      round: 1,
      mode: MODES[savedMode] ? savedMode : 'easy',
      tutorial: !localStorage.getItem(TUTORIAL_KEY),
      surface: SURFACES[Math.floor(Math.random() * SURFACES.length)],
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
      aimVector: {x: 0, y: 0},
      aimStartedAt: 0,
      aimDragDistance: 0,
      aimFrozen: false,
      pointerId: null,
      winner: null,
      particles: [],
      pulse: 0,
      shake: 0,
      aiTimer: null,
      lastShot: null,
      stats: {closest: Infinity, lastPower: 0, lastAngle: 0}
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
    refreshPencilClearance();
  }

  function resetGame() {
    if (state?.aiTimer) clearTimeout(state.aiTimer);
    state = makeState();
    resultOverlay.hidden = true;
    resultOverlay.classList.remove('lost');
    tutorialOverlay.hidden = !state.tutorial;
    updateMatchInfo();
    updateUI('player');
    canvas.className = 'can-aim';
    lastTime = performance.now();
  }

  function currentMode() { return MODES[state.mode]; }
  function aimWindow() { return state.tutorial ? Infinity : currentMode().aimWindow; }
  function deviceVerb() { return isTouchDevice ? 'Touch, drag and flick' : 'Hold and flick'; }
  function progress() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {wins: 0, streak: 0}; }
    catch { return {wins: 0, streak: 0}; }
  }
  function saveProgress(value) { localStorage.setItem(PROGRESS_KEY, JSON.stringify(value)); }
  function rankForWins(wins) {
    if (wins >= 15) return 'PENCIL GOD';
    if (wins >= 9) return 'MASTER';
    if (wins >= 5) return 'PRO';
    if (wins >= 2) return 'AMATEUR';
    return 'ROOKIE';
  }
  function currentProfile() {
    const wins = progress().wins;
    if (state.mode === 'easy') return wins >= 2 ? 'HUNTER' : 'ROOKIE';
    if (state.mode === 'normal') return wins >= 5 ? 'AGGRESSIVE' : 'HUNTER';
    return wins >= 12 ? 'GRANDMASTER' : wins >= 8 ? 'TRICKSTER' : 'SNIPER';
  }
  function updateMatchInfo() {
    const mode = currentMode();
    paperName.textContent = state.surface.name;
    frictionValue.textContent = state.surface.friction;
    aimLimitValue.textContent = state.tutorial ? 'PRACTICE' : `${(mode.aimWindow / 1000).toFixed(1)} SEC`;
    rangeValue.textContent = state.surface.range;
    const career = progress();
    aiMode.textContent = currentProfile();
    aiSubtitle.textContent = `${mode.label} AI · ${rankForWins(career.wins)}`;
    rankValue.textContent = rankForWins(career.wins);
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('is-active', button.dataset.mode === state.mode));
  }

  function updateUI(turn) {
    roundNumber.textContent = String(state.round).padStart(2, '0');
    turnBanner.querySelector('.turn-index').textContent = String(state.round).padStart(2, '0');
    if (turn === 'player') {
      turnBanner.classList.remove('ai-turn');
      turnBanner.querySelector('small').textContent = 'YOUR MOVE';
      turnBanner.querySelector('strong').textContent = state.tutorial ? 'Practice your first strike' : 'Draw your strike';
      instructionTitle.textContent = `${deviceVerb()} through the red center`;
      instructionText.textContent = state.tutorial
        ? 'Practice is untimed. Release when your direction and power feel right.'
        : `Release early or auto-launch at ${(aimWindow() / 1000).toFixed(1)} seconds.`;
      controlDock.classList.remove('waiting');
    } else {
      turnBanner.classList.add('ai-turn');
      turnBanner.querySelector('small').textContent = 'AI MOVE';
      turnBanner.querySelector('strong').textContent = 'AI is plotting a line';
      instructionTitle.textContent = 'The hunter is predicting your endpoint';
      instructionText.textContent = 'It balances a direct center hit against a safer landing.';
      controlDock.classList.add('waiting');
    }
    setPower(0);
    refreshPencilClearance();
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

  function pencilLength() { return Math.min(58, Math.max(38, W * .105)); }

  // The visual pencil runs from its eraser to its tip. That line is the diameter
  // of the activation circle, so a press anywhere in the circle starts a flick.
  function pencilInteractionZone(unit) {
    const length = pencilLength() + 14;
    return {
      x: unit.pos.x - Math.cos(unit.angle) * length / 2,
      y: unit.pos.y - Math.sin(unit.angle) * length / 2,
      radius: length / 2
    };
  }

  function canStartFlickAt(point, unit) {
    const zone = pencilInteractionZone(unit);
    return distance(point, zone) <= zone.radius;
  }

  function refreshPencilClearance() {
    const canAim = state?.phase === 'playerAim' && !state.aiming;
    const zone = canAim ? pencilInteractionZone(state.player) : null;
    const boardRect = canvas.getBoundingClientRect();
    hudPanels.forEach(panel => {
      const rect = panel.getBoundingClientRect();
      const nearestX = clamp(zone ? boardRect.left + zone.x : 0, rect.left, rect.right);
      const nearestY = clamp(zone ? boardRect.top + zone.y : 0, rect.top, rect.bottom);
      const overlaps = Boolean(zone) && Math.hypot(boardRect.left + zone.x - nearestX, boardRect.top + zone.y - nearestY) <= zone.radius + 8;
      panel.classList.toggle('pencil-clearance', overlaps);
    });
    board.classList.toggle('pencil-ready', Boolean(zone));
  }

  function pointerDown(e) {
    if (state.phase !== 'playerAim') return;
    if (state.aiming) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = pointFromEvent(e);
    if (!canStartFlickAt(p, state.player)) return;
    e.preventDefault();
    e.stopPropagation();
    initAudio();
    state.aiming = true;
    state.pointerId = e.pointerId;
    state.aimStart = p;
    state.aimVector = {x: 0, y: 0};
    state.aimStartedAt = performance.now();
    state.aimDragDistance = 0;
    state.aimFrozen = false;
    state.aimPoint = {...state.player.pos};
    state.aimPower = 0;
    board.setPointerCapture(e.pointerId);
    canvas.className = 'is-aiming';
    instructionTitle.textContent = 'The pencil tip follows your exact gesture centerline';
    instructionText.textContent = state.tutorial
      ? 'Practice mode: take your time, then release to launch.'
      : `Adjust for ${(aimWindow() / 1000).toFixed(1)} seconds; it launches when time expires.`;
  }

  function pointerMove(e) {
    if (!state.aiming || e.pointerId !== state.pointerId) return;
    e.preventDefault();
    if (updateAimFromEvent(e)) commitPlayerAim();
  }

  function updateAimFromEvent(e) {
    if (updateAimPower()) return true;
    const samples = e.getCoalescedEvents?.();
    const p = pointFromEvent(samples?.length ? samples.at(-1) : e);
    const origin = state.player.pos;
    const dx = p.x - state.aimStart.x, dy = p.y - state.aimStart.y;
    const len = Math.hypot(dx, dy);
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
    const holdPower = Math.min(1, elapsed / (Number.isFinite(aimWindow()) ? aimWindow() : 800));
    state.aimPower = Math.min(1, dragPower * DRAG_POWER_WEIGHT + holdPower * HOLD_POWER_WEIGHT);
    setPower(state.aimPower);
    if (Number.isFinite(aimWindow()) && elapsed >= aimWindow()) {
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
    if (state.pointerId !== null && board.hasPointerCapture(state.pointerId)) {
      board.releasePointerCapture(state.pointerId);
    }
    canvas.className = '';
    const dx = state.aimVector.x;
    const dy = state.aimVector.y;
    const len = Math.hypot(dx, dy);
    if (len < MIN_DRAG) {
      state.aimPoint = null;
      state.aimPower = 0;
      canvas.className = 'can-aim';
      updateUI('player');
      return;
    }
    const speed = 180 + Math.max(.08, power) * (MAX_SPEED - 180);
    launch('player', {x: dx / len * speed, y: dy / len * speed}, power);
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
    canvas.className = state.phase === 'playerAim' ? 'can-aim' : '';
    updateUI('player');
  }

  function launch(owner, velocity, power = null) {
    const unit = state[owner];
    const shotAngle = Math.atan2(velocity.y, velocity.x);
    state.active = owner;
    state.phase = 'moving';
    unit.vel = {...velocity};
    unit.angle = shotAngle;
    unit.moveFriction = paperFrictionForAngle(shotAngle, state.surface.factor);
    unit.startPos = {...unit.pos};
    state.currentTrail = {
      owner,
      points: [{...unit.pos}],
      seed: Math.random() * 1000,
      distance: 0,
      closest: Infinity,
      power: power ?? clamp((Math.hypot(velocity.x, velocity.y) - 180) / (MAX_SPEED - 180), 0, 1),
      angle: shotAngle
    };
    state.trails.push(state.currentTrail);
    state.aimPoint = null;
    state.aimPower = 0;
    state.aimStart = null;
    state.aimVector = {x: 0, y: 0};
    state.aimDragDistance = 0;
    state.aimFrozen = false;
    setPower(0);
    refreshPencilClearance();
    haptic(owner === 'player' ? 8 : 4);
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
      const centerDistance = segmentDistance(old, unit.pos, target.pos);
      state.currentTrail.closest = Math.min(state.currentTrail.closest, centerDistance);
      if (owner === 'player') state.stats.closest = Math.min(state.stats.closest, centerDistance);
      if (centerDistance <= CENTER_HIT_TOLERANCE) {
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
    state.lastShot = {...state.currentTrail};
    if (owner === 'player') {
      state.stats.lastPower = state.currentTrail.power;
      state.stats.lastAngle = state.currentTrail.angle;
    }
    state.currentTrail = null;
    playTick(owner === 'player' ? 330 : 240, .06);
    if (owner === 'player') {
      state.phase = 'aiThinking';
      updateUI('ai');
      aiMode.textContent = 'SCANNING';
      const feedback = shotFeedback(state.lastShot.closest);
      turnBanner.querySelector('strong').textContent = feedback.title;
      instructionTitle.textContent = feedback.title;
      instructionText.textContent = feedback.detail;
      if (state.tutorial) {
        state.tutorial = false;
        localStorage.setItem(TUTORIAL_KEY, '1');
        updateMatchInfo();
      }
      state.aiTimer = setTimeout(takeAiTurn, 1050);
    } else {
      state.round += 1;
      state.phase = 'playerAim';
      state.active = 'player';
      canvas.className = 'can-aim';
      aiMode.textContent = currentProfile();
      updateUI('player');
    }
  }

  function takeAiTurn() {
    if (state.phase !== 'aiThinking') return;
    const choice = chooseAiShot();
    aiMode.textContent = choice.direct ? 'LOCKED' : choice.mode;
    turnBanner.querySelector('strong').textContent = choice.direct ? 'AI locked an intercept line' : 'AI pencil in motion';
    launch('ai', choice.velocity, choice.power);
  }

  function chooseAiShot() {
    const start = state.ai.pos;
    const target = state.player.pos;
    const lm = state.player.lastMove;
    const profile = currentProfile();
    const predictionLead = profile === 'TRICKSTER' ? .84 : profile === 'GRANDMASTER' ? .68 : .52;
    const predicted = {
      x: clamp(target.x + lm.x * predictionLead, EDGE, W - EDGE),
      y: clamp(target.y + lm.y * predictionLead, EDGE + 22, H - EDGE - 44)
    };
    const baseAngle = Math.atan2(target.y - start.y, target.x - start.x);
    const predictedAngle = Math.atan2(predicted.y - start.y, predicted.x - start.x);
    const candidates = [];
    const powers = currentMode().powers;
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
      const dangerWeight = profile === 'AGGRESSIVE' ? .08 : profile === 'GRANDMASTER' ? .32 : .22;
      const danger = Math.max(0, 470 - playerReach) * dangerWeight + (playerReach < 85 ? (profile === 'AGGRESSIVE' ? 80 : 240) : 0);
      const edgePenalty = Math.max(0, 64 - edgeSpace) * 1.7;
      const directBonus = sim.hit ? -100000 + sim.time * 120 : 0;
      const score = directBonus + sim.minTarget * 8.5 + sim.minPredicted * 1.35 + danger + edgePenalty + c.power * 8;
      if (!best || score < best.score) best = {...c, ...sim, score};
    }
    const speed = 180 + best.power * (MAX_SPEED - 180);
    // The AI plans geometrically, but executes like a real hand: early shots have
    // a little more angular error and become steadier as the duel continues.
    const profilePrecision = profile === 'GRANDMASTER' ? .012 : profile === 'TRICKSTER' ? .018 : currentMode().aiError;
    const directError = Math.max(.010, profilePrecision - state.round * .004);
    const aimError = best.hit
      ? (Math.random() * 2 - 1) * directError
      : (Math.random() * 2 - 1) * .026;
    const shotAngle = best.angle + aimError;
    return {
      velocity: {x: Math.cos(shotAngle) * speed, y: Math.sin(shotAngle) * speed},
      power: best.power,
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
    if (state.currentTrail) {
      state.lastShot = {...state.currentTrail};
      if (state.currentTrail.owner === 'player') {
        state.stats.closest = Math.min(state.stats.closest, state.currentTrail.closest);
        state.stats.lastPower = state.currentTrail.power;
        state.stats.lastAngle = state.currentTrail.angle;
      }
    }
    stopScratch();
    canvas.className = '';
    state.shake = 8;
    spawnHitParticles(state[winner === 'player' ? 'ai' : 'player'].pos, winner);
    playHit(winner === 'player');
    haptic(winner === 'player' ? [16, 28, 20] : [32, 28, 32]);
    const saved = progress();
    const nextProgress = winner === 'player'
      ? {wins: saved.wins + 1, streak: saved.streak + 1}
      : {wins: saved.wins, streak: 0};
    saveProgress(nextProgress);
    updateMatchInfo();
    setTimeout(() => {
      resultOverlay.hidden = false;
      resultOverlay.classList.toggle('lost', winner === 'ai');
      resultTitle.textContent = winner === 'player' ? 'PLAYER WINS' : 'COMPUTER WINS';
      const closest = Number.isFinite(state.stats.closest) ? state.stats.closest : state.lastShot?.closest;
      const displayClosest = Number.isFinite(closest) ? closest : 0;
      const accuracy = winner === 'player' ? 100 : Math.max(0, Math.round(100 - displayClosest * 3.2));
      resultText.textContent = winner === 'player'
        ? "Perfect line: you crossed the computer's exact center point."
        : `Computer wins. Your closest trace was ${displayClosest.toFixed(1)} px from center.`;
      resultClosest.textContent = `${displayClosest.toFixed(1)} px`;
      resultAccuracy.textContent = `${accuracy}%`;
      resultPower.textContent = `${Math.round(state.stats.lastPower * 100)}%`;
      resultStreak.textContent = String(nextProgress.streak).padStart(2, '0');
    }, 620);
  }

  function shotFeedback(closest) {
    if (!Number.isFinite(closest)) return {title: 'TRACE COMPLETE', detail: 'Set up your next line before the AI moves.'};
    if (closest <= 8) return {title: `GREAT — ${closest.toFixed(1)} px AWAY`, detail: 'That was nearly a center hit. Keep that line in mind.'};
    if (closest <= 20) return {title: `CLOSE — ${closest.toFixed(1)} px AWAY`, detail: 'A tiny angle or power adjustment can convert this.'};
    return {title: `MISS BY ${closest.toFixed(1)} px`, detail: 'Use the trace to read your next intercept.'};
  }

  function haptic(pattern) {
    if (isTouchDevice && navigator.vibrate) navigator.vibrate(pattern);
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
    drawPencilInteractionZone();
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
    if (owner === 'ai' && state.tutorial && state.phase !== 'gameOver') {
      ctx.save();
      ctx.translate(unit.pos.x, unit.pos.y);
      ctx.strokeStyle = COLORS.ai; ctx.fillStyle = COLORS.ai;
      ctx.globalAlpha = .65 + Math.sin(state.pulse * 4) * .18;
      ctx.lineWidth = 1.2;
      [12, 20, 28].forEach(radius => { ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke(); });
      ctx.globalAlpha = .72;
      ctx.font = '700 8px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center';
      ctx.fillText('CROSS THIS DOT', 0, -35);
      ctx.restore();
    }
  }

  function drawPencil(owner) {
    const unit = state[owner];
    const moving = state.phase === 'moving' && state.active === owner;
    const color = owner === 'player' ? COLORS.player : COLORS.ai;
    const dark = owner === 'player' ? COLORS.playerDark : COLORS.aiDark;
    const highlight = owner === 'player' ? '#63e3d7' : '#ffb27e';
    const eraser = owner === 'player' ? '#3bc8bd' : '#f28b58';
    const length = pencilLength();
    ctx.save();
    ctx.translate(unit.pos.x, unit.pos.y);
    ctx.rotate(unit.angle);

    if (moving) {
      const blur = ctx.createLinearGradient(-length - 56, 0, -length, 0);
      blur.addColorStop(0, 'rgba(255,255,255,0)');
      blur.addColorStop(1, owner === 'player' ? 'rgba(15,156,156,.22)' : 'rgba(230,119,55,.22)');
      ctx.strokeStyle = blur; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-length - 54, 0); ctx.lineTo(-length - 8, 0); ctx.stroke();
    }

    ctx.shadowColor = 'rgba(12,30,29,.34)'; ctx.shadowBlur = 13; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 7;
    ctx.fillStyle = dark; roundRect(ctx, -length, -6, length - 8, 12, 2.5); ctx.fill();
    ctx.shadowColor = 'transparent';

    const body = ctx.createLinearGradient(0, -6, 0, 6);
    body.addColorStop(0, dark); body.addColorStop(.18, color); body.addColorStop(.46, highlight); body.addColorStop(.58, color); body.addColorStop(1, dark);
    ctx.fillStyle = body; roundRect(ctx, -length + 1, -5.4, length - 9, 10.8, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.beginPath(); ctx.moveTo(-length + 5, -4.4); ctx.lineTo(-9, -4.4); ctx.lineTo(-9, -2.2); ctx.lineTo(-length + 5, -1.7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.beginPath(); ctx.moveTo(-length + 4, 2.4); ctx.lineTo(-9, 2); ctx.lineTo(-9, 5); ctx.lineTo(-length + 4, 5); ctx.closePath(); ctx.fill();

    const wood = ctx.createLinearGradient(-8, 0, 0, 0);
    wood.addColorStop(0, '#cda96f'); wood.addColorStop(.48, '#f1dbaf'); wood.addColorStop(1, '#b58d56');
    ctx.fillStyle = wood;
    ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(0, 0); ctx.lineTo(-8, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(91,62,31,.2)'; ctx.lineWidth = .65;
    ctx.beginPath(); ctx.moveTo(-8, -3.4); ctx.lineTo(-1.8, 0); ctx.lineTo(-8, 3.4); ctx.stroke();
    ctx.fillStyle = '#283735';
    ctx.beginPath(); ctx.moveTo(-2.8, -1.65); ctx.lineTo(.6, 0); ctx.lineTo(-2.8, 1.65); ctx.closePath(); ctx.fill();

    const metal = ctx.createLinearGradient(0, -6, 0, 6);
    metal.addColorStop(0, '#8f9997'); metal.addColorStop(.28, '#f1f2ed'); metal.addColorStop(.5, '#aeb7b4'); metal.addColorStop(.72, '#fafaf5'); metal.addColorStop(1, '#727d7a');
    ctx.fillStyle = metal; ctx.fillRect(-length - 7, -6, 8, 12);
    ctx.strokeStyle = 'rgba(57,69,66,.28)'; ctx.lineWidth = .6;
    [-length - 5, -length - 2].forEach(x => { ctx.beginPath(); ctx.moveTo(x, -5.5); ctx.lineTo(x, 5.5); ctx.stroke(); });
    ctx.fillStyle = eraser; roundRect(ctx, -length - 14, -5.7, 7, 11.4, 2.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)'; roundRect(ctx, -length - 13, -4.5, 2, 8, 1); ctx.fill();
    ctx.restore();
  }

  function drawPencilInteractionZone() {
    if (state.phase !== 'playerAim' || state.aiming) return;
    const zone = pencilInteractionZone(state.player);
    ctx.save();
    ctx.strokeStyle = COLORS.player;
    ctx.globalAlpha = .3 + Math.sin(state.pulse * 3) * .08;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
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

  board.addEventListener('pointerdown', pointerDown);
  board.addEventListener('pointermove', pointerMove);
  board.addEventListener('pointerup', pointerUp);
  board.addEventListener('pointercancel', pointerCancel);
  document.getElementById('resetButton').addEventListener('click', resetGame);
  document.getElementById('playAgainButton').addEventListener('click', resetGame);
  document.getElementById('startTutorialButton').addEventListener('click', () => {
    tutorialOverlay.hidden = true;
    canvas.className = 'can-aim';
    updateUI('player');
  });
  harderButton.addEventListener('click', () => {
    const order = ['easy', 'normal', 'expert'];
    const next = order[Math.min(order.indexOf(state.mode) + 1, order.length - 1)];
    localStorage.setItem(MODE_KEY, next);
    localStorage.setItem(TUTORIAL_KEY, '1');
    resetGame();
  });
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    if (!MODES[button.dataset.mode]) return;
    localStorage.setItem(MODE_KEY, button.dataset.mode);
    localStorage.setItem(TUTORIAL_KEY, '1');
    resetGame();
  }));
  telemetryToggle.addEventListener('click', () => {
    const expanded = telemetry.classList.toggle('show-details');
    telemetryToggle.setAttribute('aria-expanded', String(expanded));
    telemetryToggle.textContent = expanded ? 'DETAILS −' : 'DETAILS +';
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { lastTime = performance.now(); });

  resize();
  resetGame();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(frame);
})();
