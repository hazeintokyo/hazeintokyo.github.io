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
  let scrollDirection = 1;
  const duration = asset.frames / asset.fps;
  const idleVelocity = 1;
  const maxVelocity = 10;
  const wrap = n => ((n % duration) + duration) % duration;
  const defaultVelocity = () => -scrollDirection * idleVelocity;
  canvas.width = canvas.height = asset.size;
  function stop() {
    if (pointer && root.hasPointerCapture(pointer.id)) root.releasePointerCapture(pointer.id);
    key = null; velocity = 0; pointer = null;
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
    } catch (_) { stop(); status.textContent = 'Animation unavailable. Reload to try again.'; }
  }
  function tick(now) {
    raf = 0;
    const dt = Math.min((now - previous) / 1000, .05); previous = now;
    if (!active) return;
    if (key) velocity = (key === 'ArrowRight' ? 1 : -1) * Math.min(1 + (now - held) / 250, 10);
    else velocity += (defaultVelocity() - velocity) * (1 - Math.exp(-7 * dt));
    const next = wrap(position + velocity * dt);
    position = next; draw();
    // Keep advancing while motion is enabled. The previous condition stopped
    // the loop once velocity reached the idle target, so idle animation only
    // rendered one frame instead of continuing through the sprite sheet.
    if (active && !document.hidden) {
      raf = requestAnimationFrame(tick);
    }
  }
  function wake() {
    if (!active || document.hidden || raf) return;
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
    if (!active || e.ctrlKey) return;
    e.preventDefault();
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    let d = horizontal ? -e.deltaX : e.deltaY;
    d *= e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    if (d) scrollDirection = d > 0 ? 1 : -1;
    position = wrap(position + d * .005);
    velocity = Math.max(-maxVelocity, Math.min(maxVelocity, velocity + d * .025));
    draw(); wake();
  }, {passive:false});
  root.addEventListener('pointerdown', e => {
    if (!active || !e.isPrimary || e.button !== 0) return;
    // Edge-origin touch gestures belong to the browser, even if they move inward.
    if (phone.matches && e.pointerType !== 'mouse') {
      const bounds = gesture.getBoundingClientRect();
      if (e.clientX < bounds.left || e.clientX >= bounds.right) { stop(); return; }
    }
    stop(); pointer = {id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now(),touch:e.pointerType !== 'mouse'};
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const now = performance.now(), d = (pointer.touch && !phone.matches ? pointer.y - e.clientY : e.clientX - pointer.x) * .01;
    position = wrap(position + d); velocity = Math.max(-10, Math.min(10, d / Math.max(.016,(now-pointer.time)/1000)));
    Object.assign(pointer,{x:e.clientX,y:e.clientY,time:now}); draw();
  });
  root.addEventListener('pointerup', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    if (performance.now()-pointer.time > 100) velocity = 0;
    pointer = null; root.releasePointerCapture(e.pointerId); wake();
  });
  root.addEventListener('pointercancel', stop);
  root.addEventListener('lostpointercapture', () => { if (pointer) stop(); });
  window.addEventListener('keydown', e => {
    if (!active || !['ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault(); if (key === e.key) return;
    key = e.key; held = performance.now(); position = wrap(position + (key === 'ArrowRight' ? 1 : -1)/asset.fps); draw(); wake();
  });
  window.addEventListener('keyup', e => { if (e.key === key) key = null; });
  window.addEventListener('blur', stop);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else wake(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, {once:true});
  else load();
})();
