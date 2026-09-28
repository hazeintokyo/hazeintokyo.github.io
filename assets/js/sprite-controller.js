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
  const selected = phone.matches ? assets.phone : largeScreen.matches ? assets.large : assets.medium;
  const fallbackSizes = [assets.large.size,assets.medium.size,assets.phone.size];
  const asset = {...selected,frames:assets.frames,fps:assets.fps,columns:assets.columns,rows:assets.rows};
  const root = document.querySelector('[data-haze]');
  const canvas = document.querySelector('[data-animation]');
  const gesture = document.querySelector('[data-gesture]');
  const status = document.querySelector('[data-status]');
  const ctx = canvas.getContext('2d');
  let image, ready = false, active = false, loading = false;
  let position = 0, velocity = 0, tapMotion = 0, last = -1, raf = 0, previous = 0, key = null, held = 0, pointer = null;
  let direction = -1, opposing = 0, wheel = null, momentumDecay = 0, suspended = document.hidden;
  const duration = asset.frames / asset.fps;
  const idleVelocity = 1.6;
  const maxVelocity = 14;
  const dragSensitivity = .022;
  const wheelSensitivity = .011;
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
  const coastMaxDistance = (coastMaxDuration - coastBaseDuration) / coastSecondsPerUnit;
  const tapDecay = 2;
  const addDistance = (distance, delta, sensitivity) => Math.min(coastMaxDistance, distance + Math.abs(delta) * sensitivity);
  function startCoast(distance) {
    if (!distance) return;
    momentumDecay = -Math.log(.05) / Math.min(coastMaxDuration, coastBaseDuration + distance * coastSecondsPerUnit);
    velocity = direction * Math.min(maxVelocity, Math.max(velocity * direction, idleVelocity + coastMinimumBoost));
  }
  const wrap = n => ((n % duration) + duration) % duration;
  const defaultVelocity = () => direction * idleVelocity;
  const clampVelocity = n => Math.max(-maxVelocity, Math.min(maxVelocity, n));
  const shortestDelta = (target, current) => {
    let delta = target - current;
    if (delta > duration / 2) delta -= duration;
    if (delta < -duration / 2) delta += duration;
    return delta;
  };
  // Only deliberate opposing movement changes the remembered idle direction.
  function remember(delta, threshold) {
    if (!delta) return false;
    if (Math.sign(delta) === direction) { opposing = 0; return false; }
    opposing += Math.abs(delta);
    if (opposing < threshold) return false;
    direction = Math.sign(delta); opposing = 0; velocity = 0; momentumDecay = 0;
    return true;
  }
  function releasePointer() {
    const current = pointer;
    pointer = null;
    if (current && root.hasPointerCapture(current.id)) root.releasePointerCapture(current.id);
  }
  canvas.width = canvas.height = asset.size;
  function stop() {
    releasePointer();
    key = null; wheel = null; opposing = 0; velocity = 0; tapMotion = 0; momentumDecay = 0;
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
    if (pointer) {
      const distance = shortestDelta(pointer.target, position);
      position = wrap(position + distance * (1 - Math.exp(-dragSmoothing * dt)));
      draw();
    } else {
      if (key) velocity = direction * Math.min(1 + (now - held) / 250, maxVelocity);
      else {
        if (wheel && now - wheel.time >= 160) { startCoast(wheel.distance); wheel = null; opposing = 0; }
        const target = wheel ? direction * Math.max(idleVelocity, wheel.speed) : defaultVelocity();
        const decay = wheel ? 18 : momentumDecay || 7;
        velocity += (target - velocity) * (1 - Math.exp(-decay * dt));
      }
      position = wrap(position + (velocity + tapMotion) * dt);
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
  async function load() {
    if (loading) return;
    loading = true; status.textContent = 'Loading animation…';
    loadPoster();
    try {
      let candidate = asset;
      while (true) {
        const next = new Image(); next.src = candidate.url;
        try { await next.decode(); image = next; asset.url = candidate.url; asset.size = candidate.size; break; }
        catch (error) {
          const index = fallbackSizes.indexOf(candidate.size);
          if (index < 0 || index + 1 >= fallbackSizes.length) throw error;
          candidate = [assets.large,assets.medium,assets.phone].find(item => item.size === fallbackSizes[index + 1]);
        }
      }
      const frameWidth = image.naturalWidth / asset.columns;
      const frameHeight = image.naturalHeight / asset.rows;
      if (!Number.isInteger(frameWidth) || frameWidth < 1 || frameWidth !== frameHeight) throw Error('Expected a 16 by 15 grid of square frames');
      asset.size = frameWidth;
      canvas.width = canvas.height = asset.size;
      last = -1;
      ready = true; draw();
      active = true; velocity = defaultVelocity(); root.classList.add('haze--active');
      status.textContent = 'Scroll, drag, tap, or hold left and right arrows to interact.';
      wake();
    } catch (_) { status.textContent = 'Animation could not load. Reload to try again.'; }
    finally { loading = false; }
  }
  root.addEventListener('wheel', e => {
    if (!active || suspended || e.ctrlKey) return;
    if (e.cancelable) e.preventDefault();
    if (pointer || key || (!e.deltaX && !e.deltaY)) return;
    momentumDecay = 0; tapMotion = 0;
    const now = performance.now();
    const x = e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerWidth : 1);
    const y = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
    if (!wheel || now - wheel.time >= 160) {
      wheel = {axis:Math.abs(x) > Math.abs(y) ? 'x' : 'y',time:now,speed:0,distance:0};
      opposing = 0; velocity = 0;
    }
    const delta = wheel.axis === 'x' ? -x : y;
    const elapsed = Math.max(.016, (now - wheel.time) / 1000);
    wheel.time = now;
    if (!delta) return;
    if (remember(delta, 4)) { wheel.speed = 0; wheel.distance = 0; }
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
    stop();
    const now = performance.now();
    pointer = {id:e.pointerId,type:e.pointerType,x:e.clientX,time:now,startX:e.clientX,startTime:now,moved:0,distance:0,target:position,samples:[{time:now,x:e.clientX}]};
    root.setPointerCapture(e.pointerId);
    wake();
  });
  root.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const now = performance.now();
    const samples = typeof e.getCoalescedEvents === 'function' ? [...e.getCoalescedEvents()] : [];
    if (!samples.length || samples[samples.length - 1].clientX !== e.clientX) samples.push(e);
    for (const sample of samples) {
      const delta = sample.clientX - pointer.x;
      if (!delta) continue;
      if (remember(delta, 3)) {
        pointer.distance = 0;
        pointer.samples = [{time:now,x:pointer.x}];
        // Drop any unrendered movement from the previous direction so a
        // deliberate reversal cannot drag the released motion back with it.
        pointer.target = position;
      }
      pointer.target = wrap(pointer.target + delta * dragSensitivity);
      pointer.moved += Math.abs(delta);
      if (Math.sign(delta) === direction) pointer.distance = addDistance(pointer.distance, delta, dragSensitivity);
      pointer.samples.push({time:now,x:sample.clientX});
      Object.assign(pointer,{x:sample.clientX,time:now});
    }
    // Keep one sample before the window boundary so release can interpolate it.
    while (pointer.samples.length > 2 && pointer.samples[1].time < now - 80) pointer.samples.shift();
    wake();
  });
  root.addEventListener('pointerup', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const now = performance.now(), samples = pointer.samples;
    velocity = 0;
    const tap = pointer.type === 'mouse'
      ? now - pointer.startTime <= mouseClickDuration && pointer.moved <= mouseClickDistance
      : now - pointer.startTime <= tapDuration && pointer.moved <= tapDistance &&
        Math.abs(pointer.x - pointer.startX) < tapNetDistance;
    if (tap) {
      const bounds = (phone.matches ? gesture : root).getBoundingClientRect?.() || {left:0,right:innerWidth};
      const midpoint = bounds.left + (bounds.right - bounds.left) / 2;
      direction = pointer.startX < midpoint ? -1 : 1;
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
        if (Math.sign(speed) === direction) velocity = clampVelocity(speed);
      }
    }
    if (!tap && now - pointer.time <= 100 && pointer.distance > 0) {
      const lag = shortestDelta(pointer.target, position);
      if (Math.abs(lag) > .001 && Math.sign(lag) === direction) velocity = clampVelocity(velocity + lag * 8);
    }
    if (!tap && now - pointer.time <= 100) startCoast(pointer.distance);
    releasePointer(); opposing = 0; wake();
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
    wheel = null; opposing = 0; velocity = 0; tapMotion = 0; momentumDecay = 0;
    key = e.key; direction = key === 'ArrowRight' ? 1 : -1;
    held = performance.now(); position = wrap(position + direction/asset.fps); draw(); wake();
  });
  window.addEventListener('keyup', e => { if (e.key === key) key = null; });
  window.addEventListener('blur', () => { suspended = true; stop(); });
  window.addEventListener('focus', () => { suspended = document.hidden; wake(); });
  document.addEventListener('visibilitychange', () => {
    suspended = document.hidden;
    if (suspended) stop(); else wake();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, {once:true});
  else load();
})();
