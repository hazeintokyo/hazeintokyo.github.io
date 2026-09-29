(() => {
  'use strict';
  const assets = {
    phone: {url:'assets/media/haze-sheet-480.webp',size:480},
    medium: {url:'assets/media/haze-sheet-600.webp',size:600},
    large: {url:'assets/media/haze-sheet-700.webp',size:700},
    frames:240, fps:18, columns:16, rows:15
  };
  const phone = matchMedia('(max-width: 767px) and (pointer: coarse)');
  const largeScreen = matchMedia('(min-width: 1440px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const selectedTier = () => phone.matches ? assets.phone : largeScreen.matches ? assets.large : assets.medium;
  const asset = {...selectedTier(),frames:assets.frames,fps:assets.fps,columns:assets.columns,rows:assets.rows};
  const root = document.querySelector('[data-haze]');
  const canvas = document.querySelector('[data-animation]');
  const gesture = document.querySelector('[data-gesture]');
  const status = document.querySelector('[data-status]');
  const ctx = canvas.getContext('2d');
  let image, ready = false, active = false, loadingForTier = null, loadedForTier = null, loadGeneration = 0;
  let position = 0, velocity = 0, tapMotion = 0, last = -1, raf = 0, previous = 0, key = null, held = 0, pointer = null;
  const directionStorageKey = 'haze-animation-direction';
  const positionStorageKey = 'haze-animation-position';
  let direction = -1, opposing = 0, wheel = null, momentumDecay = 0, coastDistance = 0, coastExpiresAt = 0, suspended = document.hidden;
  try {
    const savedDirection = Number(localStorage.getItem(directionStorageKey));
    if (savedDirection === -1 || savedDirection === 1) direction = savedDirection;
  } catch (_) { /* Storage may be unavailable; keep the default direction. */ }
  function saveDirection() {
    try { localStorage.setItem(directionStorageKey, String(direction)); }
    catch (_) { /* Animation still works when storage is unavailable. */ }
  }
  try {
    const savedPosition = Number(localStorage.getItem(positionStorageKey));
    if (Number.isFinite(savedPosition) && savedPosition >= 0 && savedPosition < assets.frames) position = savedPosition / assets.fps;
  } catch (_) { /* Storage may be unavailable; start from the first frame. */ }
  const duration = asset.frames / asset.fps;
  let lastSavedFrame = null, lastSavedAt = -Infinity;
  function savePosition(force=false) {
    const frame = Math.round(position * asset.fps) % asset.frames;
    const now = performance.now();
    if (!force && (frame === lastSavedFrame || now - lastSavedAt < 500)) return;
    try { localStorage.setItem(positionStorageKey, String(frame)); lastSavedFrame = frame; lastSavedAt = now; }
    catch (_) { /* Animation still works when storage is unavailable. */ }
  }
  const motionScale = () => reducedMotion.matches ? .25 : 1;
  const idleVelocity = 1.6;
  const maxVelocity = 14;
  const dragSensitivity = .044;
  const wheelSensitivity = .022;
  const dragSmoothing = 32;
  const tapDuration = 280;
  const tapDistance = 12;
  const tapNetDistance = 2;
  const mouseClickDuration = 500;
  const mouseClickDistance = 6;
  const tapImpulse = 3.5;
  // Gesture distance sets the time to lose 95% of extra speed.
  const coastBaseDuration = 3;
  const coastSecondsPerUnit = .8333333333;
  const coastMaxDuration = 8;
  const coastMinimumBoost = .75;
  const coastDistanceSpeedBoost = 1.2;
  const coastMaxDistance = (coastMaxDuration - coastBaseDuration) / coastSecondsPerUnit;
  const tapDecay = 2;
  const addDistance = (distance, delta, sensitivity) => Math.min(coastMaxDistance, distance + Math.abs(delta) * sensitivity);
  function expireCoast(now=performance.now()) {
    if (coastExpiresAt && now >= coastExpiresAt) { coastDistance = 0; coastExpiresAt = 0; }
  }
  function startCoast(distance, releaseVelocity=velocity, carriedVelocity=0) {
    const now = performance.now();
    expireCoast(now);
    if (!distance) return;
    coastDistance = Math.min(coastMaxDistance, coastDistance + distance);
    const settlingTime = Math.min(coastMaxDuration, coastBaseDuration + coastDistance * coastSecondsPerUnit);
    momentumDecay = -Math.log(.05) / settlingTime;
    coastExpiresAt = now + settlingTime * 1000;
    const chargedVelocity = Math.max(direction * releaseVelocity, direction * carriedVelocity,
      idleVelocity + coastMinimumBoost + coastDistance * coastDistanceSpeedBoost);
    velocity = direction * Math.min(maxVelocity, chargedVelocity);
  }
  const wrap = n => ((n % duration) + duration) % duration;
  const defaultVelocity = () => direction * idleVelocity;
  const clampVelocity = n => Math.max(-maxVelocity, Math.min(maxVelocity, n));
  const sampleTime = (sample, now) => {
    const stamp = Number(sample.timeStamp);
    return Number.isFinite(stamp) && stamp >= 0 && Math.abs(stamp - now) < 1000 ? Math.min(now, stamp) : now;
  };
  // Only deliberate opposing movement changes the remembered idle direction.
  function remember(delta, threshold) {
    if (!delta) return false;
    if (Math.sign(delta) === direction) { opposing = 0; return false; }
    opposing += Math.abs(delta);
    if (opposing < threshold) return false;
    direction = Math.sign(delta); saveDirection(); opposing = 0; velocity = 0; momentumDecay = 0; coastDistance = 0; coastExpiresAt = 0;
    return true;
  }
  function releasePointer() {
    const current = pointer;
    pointer = null;
    if (current && root.hasPointerCapture(current.id)) root.releasePointerCapture(current.id);
  }
  canvas.width = canvas.height = asset.size;
  function stop() {
    savePosition(true);
    releasePointer();
    key = null; wheel = null; opposing = 0; velocity = 0; tapMotion = 0; momentumDecay = 0; coastDistance = 0; coastExpiresAt = 0;
    cancelAnimationFrame(raf); raf = 0;
  }
  function draw() {
    if (!ready) return;
    const n = Math.round(position * asset.fps) % asset.frames;
    if (n === last) return;
    try {
      // Copy replaces transparent pixels too, without retaining trails.
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(image, n % asset.columns * asset.size, Math.floor(n / asset.columns) * asset.size,
        asset.size, asset.size, 0, 0, asset.size, asset.size);
      last = n; canvas.dataset.frame = n;
    } catch (_) { active = false; stop(); status.textContent = 'Animation unavailable. Reload to try again.'; }
  }
  function tick(now) {
    raf = 0;
    const dt = Math.min((now - previous) / 1000, .05); previous = now;
    if (!active || suspended || document.hidden) return;
    expireCoast(now);
    if (pointer) {
      pointer.renderPosition += (pointer.target - pointer.renderPosition) * (1 - Math.exp(-dragSmoothing * dt));
      position = wrap(pointer.renderPosition);
      draw();
    } else {
      if (key) velocity = direction * Math.min(1 + (now - held) / 250, maxVelocity);
      else {
        if (wheel && now - wheel.time >= 160) {
          const completedWheel = wheel; wheel = null; opposing = 0;
          startCoast(completedWheel.distance, velocity, completedWheel.carriedVelocity);
        }
        const target = wheel ? direction * Math.max(idleVelocity, wheel.speed, direction * wheel.carriedVelocity) : defaultVelocity();
        const decay = wheel ? 18 : momentumDecay || 7;
        velocity += (target - velocity) * (1 - Math.exp(-decay * dt));
      }
      position = wrap(position + (velocity + tapMotion) * dt * motionScale());
      savePosition();
      tapMotion *= Math.exp(-tapDecay * dt);
      draw();
    }
    // Keep advancing while motion is enabled. The previous condition stopped
    // the loop once velocity reached the idle target, so idle animation only
    // rendered one frame instead of continuing through the sprite sheet.
    if (active && !document.hidden) {
      raf = requestAnimationFrame(tick);
    }
  }
  function wake() {
    if (!active || suspended || document.hidden || raf) return;
    previous = performance.now(); raf = requestAnimationFrame(tick);
  }
  async function loadPoster() {
    try {
      const poster = new Image(); poster.src = 'assets/media/haze-poster.webp';
      await poster.decode();
      if (ready) return;
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(poster, 0, 0, canvas.width, canvas.height);
      canvas.dataset.frame = 'poster';
    } catch (_) { /* The title remains visible if the optional poster fails. */ }
  }
  function candidatesFor(tier) {
    const tiers = [assets.phone, assets.medium, assets.large];
    const index = tiers.indexOf(tier);
    return [tier, ...tiers.slice(0, index).reverse(), ...tiers.slice(index + 1)];
  }
  async function load() {
    const requested = selectedTier();
    if (loadedForTier === requested.size || loadingForTier === requested.size) return;
    const generation = ++loadGeneration;
    loadingForTier = requested.size;
    if (!ready) { status.textContent = 'Loading animation…'; loadPoster(); }
    try {
      for (const candidate of candidatesFor(requested)) {
        const next = new Image(); next.src = candidate.url;
        try {
          await next.decode();
          if (generation !== loadGeneration) return;
          const frameWidth = next.naturalWidth / asset.columns;
          const frameHeight = next.naturalHeight / asset.rows;
          if (!Number.isInteger(frameWidth) || frameWidth < 1 || frameWidth !== frameHeight) continue;
          image = next; asset.url = candidate.url; asset.size = frameWidth;
          canvas.width = canvas.height = frameWidth;
          last = -1;
          ready = true; draw();
          loadedForTier = requested.size;
          if (!active) { active = true; velocity = defaultVelocity(); root.classList.add('haze--active'); }
          status.textContent = 'Scroll, drag, tap, or hold left and right arrows to interact.';
          wake();
          return;
        } catch (_) {
          if (generation !== loadGeneration) return;
        }
      }
      if (!ready) status.textContent = 'Animation could not load. Reload to try again.';
    } finally { if (generation === loadGeneration) loadingForTier = null; }
  }
  root.addEventListener('wheel', e => {
    if (!active || suspended || e.ctrlKey) return;
    if (e.cancelable) e.preventDefault();
    if (pointer || key || (!e.deltaX && !e.deltaY)) return;
    const now = performance.now();
    expireCoast(now);
    const x = e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerWidth : 1);
    const y = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
    if (!wheel || now - wheel.time >= 160) {
      const carriedVelocity = momentumDecay && Math.sign(velocity) === direction ? velocity : 0;
      wheel = {axis:Math.abs(x) > Math.abs(y) ? 'x' : 'y',time:now,speed:0,distance:0,carriedVelocity};
      opposing = 0;
    }
    momentumDecay = 0; tapMotion = 0;
    const delta = wheel.axis === 'x' ? -x : y;
    const elapsed = Math.max(.016, (now - wheel.time) / 1000);
    wheel.time = now;
    if (!delta) return;
    if (remember(delta, 4)) { wheel.speed = 0; wheel.distance = 0; wheel.carriedVelocity = 0; }
    if (Math.sign(delta) === direction) {
      wheel.distance = addDistance(wheel.distance, delta, wheelSensitivity);
      const speed = Math.min(maxVelocity, Math.abs(delta) * wheelSensitivity / elapsed);
      wheel.speed += (speed - wheel.speed) * .5;
    }
    wake();
  }, {passive:false});
  root.addEventListener('pointerdown', e => {
    if (!active || suspended || pointer || !e.isPrimary || e.button !== 0) return;
    // Edge-origin touch gestures belong to the browser, even if they move inward.
    if (phone.matches && e.pointerType !== 'mouse') {
      const bounds = gesture.getBoundingClientRect();
      if (e.clientX < bounds.left || e.clientX >= bounds.right) return;
    }
    key = null; opposing = 0; tapMotion = 0;
    const now = performance.now();
    expireCoast(now);
    if (wheel) {
      const completedWheel = wheel; wheel = null;
      startCoast(completedWheel.distance, velocity, completedWheel.carriedVelocity);
    }
    const carriedVelocity = momentumDecay && Math.sign(velocity) === direction ? velocity : 0;
    pointer = {id:e.pointerId,type:e.pointerType,x:e.clientX,time:now,startX:e.clientX,startTime:now,moved:0,distance:0,
      carriedVelocity,target:position,renderPosition:position,samples:[{time:now,x:e.clientX}]};
    root.setPointerCapture(e.pointerId);
    wake();
  });
  root.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const now = performance.now();
    const samples = typeof e.getCoalescedEvents === 'function' ? [...e.getCoalescedEvents()] : [];
    if (!samples.length || samples[samples.length - 1].clientX !== e.clientX) samples.push(e);
    for (const sample of samples) {
      const at = Math.max(pointer.time, sampleTime(sample, now));
      const delta = sample.clientX - pointer.x;
      if (!delta) continue;
      if (remember(delta, 3)) {
        pointer.distance = 0;
        pointer.carriedVelocity = 0;
        pointer.samples = [{time:at,x:pointer.x}];
        // Drop any unrendered movement from the previous direction so a
        // deliberate reversal cannot drag the released motion back with it.
        pointer.target = pointer.renderPosition;
      }
      pointer.target += delta * dragSensitivity * motionScale();
      pointer.moved += Math.abs(delta);
      if (Math.sign(delta) === direction) pointer.distance = addDistance(pointer.distance, delta, dragSensitivity);
      pointer.samples.push({time:at,x:sample.clientX});
      Object.assign(pointer,{x:sample.clientX,time:at});
    }
    // Keep one sample before the window boundary so release can interpolate it.
    while (pointer.samples.length > 2 && pointer.samples[1].time < now - 80) pointer.samples.shift();
    wake();
  });
  root.addEventListener('pointerup', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const now = performance.now(), samples = pointer.samples;
    let releaseVelocity = 0;
    const tap = pointer.type === 'mouse'
      ? now - pointer.startTime <= mouseClickDuration && pointer.moved <= mouseClickDistance
      : now - pointer.startTime <= tapDuration && pointer.moved <= tapDistance &&
        Math.abs(pointer.x - pointer.startX) < tapNetDistance;
    if (tap) {
      const bounds = (phone.matches ? gesture : root).getBoundingClientRect?.() || {left:0,right:innerWidth};
      const midpoint = bounds.left + (bounds.right - bounds.left) / 2;
      const previousDirection = direction;
      direction = pointer.startX < midpoint ? -1 : 1;
      if (direction !== previousDirection) { coastDistance = 0; momentumDecay = 0; coastExpiresAt = 0; }
      saveDirection();
      velocity = defaultVelocity();
      wheel = null; opposing = 0; tapMotion = direction * tapImpulse;
    } else if (now - pointer.time <= 100 && samples.length > 1) {
      const end = samples[samples.length - 1], startTime = Math.max(now - 80, samples[0].time);
      if (end.time > startTime) {
        let i = 0;
        while (i + 1 < samples.length && samples[i + 1].time <= startTime) i++;
        const a = samples[i], b = samples[i + 1] || a;
        const fraction = b.time > a.time ? (startTime - a.time) / (b.time - a.time) : 0;
        const startX = a.x + (b.x - a.x) * fraction;
        const speed = (end.x - startX) * dragSensitivity / Math.max(.016, (now - startTime) / 1000);
        if (Math.sign(speed) === direction) releaseVelocity = clampVelocity(speed);
      }
    }
    if (!tap && now - pointer.time <= 100 && pointer.distance > 0) {
      const lag = (pointer.target - pointer.renderPosition) / motionScale();
      if (Math.abs(lag) > .001 && Math.sign(lag) === direction) releaseVelocity = clampVelocity(releaseVelocity + lag * 8);
    }
    if (!tap && now - pointer.time <= 100) startCoast(pointer.distance, releaseVelocity, pointer.carriedVelocity);
    else if (!tap) { momentumDecay = 0; coastDistance = 0; coastExpiresAt = 0; velocity = defaultVelocity(); }
    savePosition(true); releasePointer(); opposing = 0; wake();
  });
  function cancelPointer(e) {
    if (!pointer || pointer.id !== e.pointerId) return;
    stop(); wake();
  }
  root.addEventListener('pointercancel', cancelPointer);
  root.addEventListener('lostpointercapture', cancelPointer);
  window.addEventListener('keydown', e => {
    if (!active || suspended || !['ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault(); if (pointer || key === e.key) return;
    wheel = null; opposing = 0; velocity = 0; tapMotion = 0; momentumDecay = 0; coastDistance = 0; coastExpiresAt = 0;
    key = e.key; direction = key === 'ArrowRight' ? 1 : -1;
    saveDirection();
    held = performance.now(); position = wrap(position + direction/asset.fps * motionScale()); savePosition(true); draw(); wake();
  });
  window.addEventListener('keyup', e => { if (e.key === key) key = null; });
  window.addEventListener('blur', () => { suspended = true; stop(); });
  window.addEventListener('focus', () => { suspended = document.hidden; wake(); });
  document.addEventListener('visibilitychange', () => {
    suspended = document.hidden;
    if (suspended) stop(); else wake();
  });
  window.addEventListener('pagehide', () => savePosition(true));
  window.addEventListener('resize', load);
  for (const query of [phone, largeScreen]) {
    if (query.addEventListener) query.addEventListener('change', load);
    else if (query.addListener) query.addListener(load);
  }
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', () => {
    if (pointer) pointer.target = pointer.renderPosition;
    wake();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, {once:true});
  else load();
})();
