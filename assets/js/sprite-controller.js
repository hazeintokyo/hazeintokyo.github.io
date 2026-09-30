(() => {
  'use strict';

  const frameCount = 240;
  const fps = 18;
  const columns = 16;
  const rows = 15;
  const idleVelocity = 1.6;
  const dragSensitivity = .022;
  const wheelSensitivity = .011;
  const dragDirectionThreshold = 3;
  const assets = {
    phone: {url:'assets/media/haze-sheet-480.webp', size:480},
    medium: {url:'assets/media/haze-sheet-600.webp', size:600},
    large: {url:'assets/media/haze-sheet-700.webp', size:700}
  };
  const phone = matchMedia('(max-width: 767px) and (pointer: coarse)');
  const largeScreen = matchMedia('(min-width: 1440px)');
  const selectedTier = () => phone.matches ? assets.phone : largeScreen.matches ? assets.large : assets.medium;
  const root = document.querySelector('[data-haze]');
  const canvas = document.querySelector('[data-animation]');
  const gesture = document.querySelector('[data-gesture]');
  const status = document.querySelector('[data-status]');
  const ctx = canvas.getContext('2d');
  const duration = frameCount / fps;
  let image = null;
  let frameSize = canvas.width;
  let ready = false;
  let active = false;
  let loadingForTier = null;
  let loadedForTier = null;
  let loadGeneration = 0;
  let position = 0;
  let direction = -1;
  let last = -1;
  let previous = performance.now();
  let pointer = null;
  let raf = 0;

  const wrap = value => ((value % duration) + duration) % duration;

  function draw(force = false) {
    if (!ready || !image) return;
    const frame = Math.round(position * fps) % frameCount;
    if (frame === last && !force) return;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(
      image,
      frame % columns * frameSize,
      Math.floor(frame / columns) * frameSize,
      frameSize,
      frameSize,
      0,
      0,
      frameSize,
      frameSize
    );
    last = frame;
    canvas.dataset.frame = String(frame);
  }

  function wake() {
    if (!active || raf) return;
    previous = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    raf = 0;
    const delta = Math.min((now - previous) / 1000, .05);
    previous = now;
    if (!pointer) position = wrap(position + direction * idleVelocity * delta);
    draw();
    if (active) raf = requestAnimationFrame(tick);
  }

  function tierCandidates(tier) {
    const tiers = [assets.phone, assets.medium, assets.large];
    const index = tiers.indexOf(tier);
    return [tier, ...tiers.slice(0, index).reverse(), ...tiers.slice(index + 1)];
  }

  async function load() {
    const requested = selectedTier();
    if (loadedForTier === requested.size || loadingForTier === requested.size) return;
    const generation = ++loadGeneration;
    loadingForTier = requested.size;
    if (!ready) {
      status.textContent = 'Loading animation…';
      loadPoster();
    }
    try {
      for (const candidate of tierCandidates(requested)) {
        const next = new Image();
        next.src = candidate.url;
        try {
          await next.decode();
          if (generation !== loadGeneration) return;
          const width = next.naturalWidth / columns;
          const height = next.naturalHeight / rows;
          if (!Number.isInteger(width) || width < 1 || width !== height) continue;
          image = next;
          frameSize = width;
          canvas.width = canvas.height = frameSize;
          last = -1;
          ready = true;
          loadedForTier = requested.size;
          active = true;
          root.classList.add('haze--active');
          status.textContent = 'Scroll, drag, tap, or hold left and right arrows to interact.';
          draw(true);
          wake();
          return;
        } catch (_) {
          if (generation !== loadGeneration) return;
        }
      }
      if (!ready) status.textContent = 'Animation could not load. Reload to try again.';
    } finally {
      if (generation === loadGeneration) loadingForTier = null;
    }
  }

  async function loadPoster() {
    try {
      const poster = new Image();
      poster.src = 'assets/media/haze-poster.webp';
      await poster.decode();
      if (ready) return;
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(poster, 0, 0, canvas.width, canvas.height);
      canvas.dataset.frame = 'poster';
    } catch (_) {
      /* Keep the title visible if the optional poster fails. */
    }
  }

  function isControlTarget(target) {
    return Boolean(target && typeof target.closest === 'function' &&
      target.closest('button, a, input, select, textarea'));
  }

  root.addEventListener('pointerdown', event => {
    if (isControlTarget(event.target) || !event.isPrimary || event.button !== 0) return;
    if (phone.matches && event.pointerType !== 'mouse' && gesture) {
      const bounds = gesture.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX >= bounds.right) return;
    }
    pointer = {id:event.pointerId, x:event.clientX, opposingDistance:0};
    root.setPointerCapture(event.pointerId);
  });

  root.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const delta = event.clientX - pointer.x;
    pointer.x = event.clientX;
    if (!delta) return;
    const dragDirection = Math.sign(delta);
    if (dragDirection === direction) {
      pointer.opposingDistance = 0;
    } else {
      pointer.opposingDistance += Math.abs(delta);
      if (pointer.opposingDistance >= dragDirectionThreshold) {
        direction = dragDirection;
        pointer.opposingDistance = 0;
      }
    }
    position = wrap(position + delta * dragSensitivity);
    draw();
  });

  function releasePointer(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer = null;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    wake();
  }

  root.addEventListener('pointerup', releasePointer);
  root.addEventListener('pointercancel', releasePointer);
  root.addEventListener('lostpointercapture', releasePointer);

  root.addEventListener('wheel', event => {
    if (isControlTarget(event.target)) return;
    if (event.cancelable) event.preventDefault();
    const delta = event.deltaX && Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? -event.deltaX
      : event.deltaY;
    if (!delta) return;
    direction = Math.sign(delta);
    position = wrap(position + delta * wheelSensitivity);
    draw();
  }, {passive:false});

  window.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    direction = event.key === 'ArrowRight' ? 1 : -1;
    wake();
  });

  window.addEventListener('resize', () => {
    load();
    draw(true);
  });

  window.addEventListener('blur', wake);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);

  for (const query of [phone, largeScreen]) {
    if (query.addEventListener) query.addEventListener('change', load);
    else if (query.addListener) query.addListener(load);
  }

  load();
})();
