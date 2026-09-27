(() => {
  'use strict';
  const asset = { url: 'assets/media/haze-sheet.png', frames: 240, fps: 18, size: 360, columns: 16, rows: 15 };
  const root = document.querySelector('[data-haze]');
  const canvas = document.querySelector('[data-animation]');
  const gesture = document.querySelector('[data-gesture]');
  const phone = matchMedia('(max-width: 767px) and (pointer: coarse)');
  const status = document.querySelector('[data-status]');
  const ctx = canvas.getContext('2d');
  let image, ready = false, active = false, loading = false;
  let position = 0, velocity = 0, last = -1, raf = 0, previous = 0, key = null, held = 0, pointer = null;
  let direction = -1, opposing = 0, wheel = null, suspended = document.hidden;
  const duration = asset.frames / asset.fps;
  const idleVelocity = 1;
  const maxVelocity = 10;
  const dragSensitivity = .0165;
  const wheelSensitivity = .00825;
  const wrap = n => ((n % duration) + duration) % duration;
  const defaultVelocity = () => direction * idleVelocity;
  const clampVelocity = n => Math.max(-maxVelocity, Math.min(maxVelocity, n));
  // Only deliberate opposing movement changes the remembered idle direction.
  function remember(delta, threshold) {
    if (!delta) return false;
    if (Math.sign(delta) === direction) { opposing = 0; return false; }
    opposing += Math.abs(delta);
    if (opposing < threshold) return false;
    direction = Math.sign(delta); opposing = 0; velocity = 0;
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
    key = null; wheel = null; opposing = 0; velocity = 0;
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
    if (!pointer) {
      if (key) velocity = direction * Math.min(1 + (now - held) / 250, maxVelocity);
      else {
        if (wheel && now - wheel.time >= 160) { wheel = null; opposing = 0; }
        const target = wheel ? direction * Math.max(idleVelocity, wheel.speed) : defaultVelocity();
        velocity += (target - velocity) * (1 - Math.exp(-(wheel ? 18 : 7) * dt));
      }
      position = wrap(position + velocity * dt); draw();
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
  async function load() {
    if (loading) return;
    loading = true; status.textContent = 'Loading animation…';
    try {
      const next = new Image(); next.src = asset.url; await next.decode();
      const frameWidth = next.naturalWidth / asset.columns;
      const frameHeight = next.naturalHeight / asset.rows;
      if (!Number.isInteger(frameWidth) || frameWidth < 1 || frameWidth !== frameHeight) throw Error('Expected a 16 by 15 grid of square frames');
      asset.size = frameWidth;
      canvas.width = canvas.height = asset.size;
      last = -1;
      image = next; ready = true; draw();
      active = true; velocity = defaultVelocity(); root.classList.add('haze--active');
      status.textContent = 'Scroll, drag, or hold left and right arrows to interact.';
      wake();
    } catch (_) { status.textContent = 'Animation could not load. Reload to try again.'; }
    finally { loading = false; }
  }
  root.addEventListener('wheel', e => {
    if (!active || suspended || e.ctrlKey) return;
    if (e.cancelable) e.preventDefault();
    if (pointer || key || (!e.deltaX && !e.deltaY)) return;
    const now = performance.now();
    const x = e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerWidth : 1);
    const y = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
    if (!wheel || now - wheel.time >= 160) {
      wheel = {axis:Math.abs(x) > Math.abs(y) ? 'x' : 'y',time:now,speed:0};
      opposing = 0; velocity = 0;
    }
    const delta = wheel.axis === 'x' ? -x : y;
    const elapsed = Math.max(.016, (now - wheel.time) / 1000);
    wheel.time = now;
    if (!delta) return;
    if (remember(delta, 4)) wheel.speed = 0;
    if (Math.sign(delta) === direction) {
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
    pointer = {id:e.pointerId,x:e.clientX,time:now,samples:[{time:now,x:e.clientX}]};
    root.setPointerCapture(e.pointerId);
    wake();
  });
  root.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const now = performance.now(), delta = e.clientX - pointer.x;
    if (!delta) return;
    if (remember(delta, 3)) pointer.samples = [{time:now,x:pointer.x}];
    position = wrap(position + delta * dragSensitivity);
    pointer.samples.push({time:now,x:e.clientX});
    // Keep one sample before the window boundary so release can interpolate it.
    while (pointer.samples.length > 2 && pointer.samples[1].time < now - 80) pointer.samples.shift();
    Object.assign(pointer,{x:e.clientX,time:now}); draw();
  });
  root.addEventListener('pointerup', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const now = performance.now(), samples = pointer.samples;
    velocity = 0;
    if (now - pointer.time <= 100 && samples.length > 1) {
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
    wheel = null; opposing = 0; velocity = 0;
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
