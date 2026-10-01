(() => {
  'use strict';

  const frameCount = 240;
  const fps = 18;
  const columns = 16;
  const rows = 15;
  const idleVelocity = 1.6;
  const dragSensitivity = .022;
  const wheelSensitivity = .011;
  const trackpadWheelSensitivity = wheelSensitivity * .925;
  const dragDirectionThreshold = 3;
  const idleCoastMinimumBoost = .75;
  const coastDistanceSpeedBoost = 1.2;
  const coastBaseDuration = 3;
  const coastSecondsPerUnit = .8333333333;
  const coastMaxDuration = 8;
  const maxReleaseVelocity = 14;
  const tapImpulse = 3.5;
  const tapDecay = 2;
  const mouseClickImpulse = 6;
  const mouseClickDecay = 1.5;
  const keyInitialVelocity = 4;
  const keyAcceleration = 16;
  const keyMaxVelocity = 14;
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
  const directionStorageKey = 'haze-spin-direction';
  function readDirection() {
    try {
      const stored = window.localStorage?.getItem(directionStorageKey);
      if (stored === '1') return 1;
      if (stored === '-1') return -1;
    } catch (_) {
      /* Keep the default direction when browser storage is unavailable. */
    }
    return -1;
  }

  function persistDirection(value) {
    try {
      window.localStorage?.setItem(directionStorageKey, String(value));
    } catch (_) {
      /* Animation should keep working when browser storage is unavailable. */
    }
  }

  let direction = readDirection();
  persistDirection(direction);
  let image = null;
  let frameSize = canvas.width;
  let ready = false;
  let active = false;
  let loadingForTier = null;
  let loadedForTier = null;
  let loadGeneration = 0;
  let position = direction > 0 ? 0 : (frameCount - 1) / fps;
  let posterStarted = false;
  let last = -1;
  let previous = performance.now();
  let pointer = null;
  let coastBoost = 0;
  let coastDecay = 0;
  let tapBoost = 0;
  let tapBoostDecay = tapDecay;
  let heldKey = null;
  let heldKeySince = 0;
  let raf = 0;

  const wrap = value => ((value % duration) + duration) % duration;

  function setDirection(value) {
    const next = value < 0 ? -1 : 1;
    if (next === direction) return;
    direction = next;
    persistDirection(direction);
  }

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
    if (!active || raf || document.hidden) return;
    previous = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    heldKey = null;
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function resume() {
    draw(true);
    wake();
  }

  function tick(now) {
    raf = 0;
    const delta = Math.min((now - previous) / 1000, .05);
    previous = now;
    if (!pointer) {
      if (heldKey) {
        const heldSeconds = Math.max(0, (now - heldKeySince) / 1000);
        const speed = Math.min(keyMaxVelocity,
          keyInitialVelocity + heldSeconds * keyAcceleration);
        position = wrap(position + direction * speed * delta);
      } else {
        position = wrap(position + direction * (idleVelocity + coastBoost + tapBoost) * delta);
        coastBoost *= Math.exp(-coastDecay * delta);
        tapBoost *= Math.exp(-tapBoostDecay * delta);
        if (coastBoost < .001) coastBoost = 0;
        if (tapBoost < .001) tapBoost = 0;
      }
    }
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
      if (!posterStarted) {
        posterStarted = true;
        loadPoster();
      }
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

  function clearReleaseMotion() {
    coastBoost = 0;
    coastDecay = 0;
    tapBoost = 0;
    tapBoostDecay = tapDecay;
  }

  function sampleTime(sample, now) {
    const stamp = Number(sample.timeStamp);
    return Number.isFinite(stamp) && stamp >= 0 && Math.abs(stamp - now) < 1000
      ? Math.min(now, stamp) : now;
  }

  function startCoast(current, now) {
    if (!current.distance) return;
    const recentMove = now - current.lastMoveAt <= 100;
    // A mouse can stop moving before its button is released. Keep its
    // distance-based coast, but only use release velocity from recent samples.
    if (!recentMove && current.type !== 'mouse') return;
    const samples = current.samples;
    let releaseSpeed = 0;
    if (recentMove && samples.length > 1) {
      const end = samples[samples.length - 1];
      const startTime = Math.max(now - 80, samples[0].time);
      let index = 0;
      while (index + 1 < samples.length && samples[index + 1].time <= startTime) index++;
      const a = samples[index];
      const b = samples[index + 1] || a;
      const fraction = b.time > a.time ? (startTime - a.time) / (b.time - a.time) : 0;
      const startX = a.x + (b.x - a.x) * fraction;
      const elapsed = Math.max(.016, (end.time - startTime) / 1000);
      releaseSpeed = Math.max(0, direction * (end.x - startX) * dragSensitivity / elapsed);
    }
    const settlingTime = Math.min(coastMaxDuration,
      coastBaseDuration + current.distance * coastSecondsPerUnit);
    coastDecay = -Math.log(.05) / settlingTime;
    coastBoost = Math.min(maxReleaseVelocity - idleVelocity,
      Math.max(current.carriedBoost, releaseSpeed - idleVelocity,
        idleCoastMinimumBoost + current.distance * coastDistanceSpeedBoost));
  }

  root.addEventListener('pointerdown', event => {
    if (pointer || isControlTarget(event.target) || !event.isPrimary || event.button !== 0) return;
    if (phone.matches && event.pointerType !== 'mouse' && gesture) {
      const bounds = gesture.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX >= bounds.right) return;
    }
    const now = performance.now();
    const carriedBoost = coastBoost;
    clearReleaseMotion();
    heldKey = null;
    pointer = {id:event.pointerId, type:event.pointerType, x:event.clientX,
      startX:event.clientX, startTime:now, lastMoveAt:now, moved:0,
      opposingDistance:0, distance:0, carriedBoost,
      samples:[{time:now,x:event.clientX}]};
    root.setPointerCapture(event.pointerId);
  });

  root.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const now = performance.now();
    const samples = typeof event.getCoalescedEvents === 'function' ? [...event.getCoalescedEvents()] : [];
    if (!samples.length || samples[samples.length - 1].clientX !== event.clientX) samples.push(event);
    for (const sample of samples) {
      const at = Math.max(pointer.samples[pointer.samples.length - 1].time, sampleTime(sample, now));
      const delta = sample.clientX - pointer.x;
      if (!delta) continue;
      const dragDirection = Math.sign(delta);
      if (dragDirection === direction) {
        pointer.opposingDistance = 0;
      } else {
        pointer.opposingDistance += Math.abs(delta);
        if (pointer.opposingDistance >= dragDirectionThreshold) {
          setDirection(dragDirection);
          pointer.opposingDistance = 0;
          pointer.distance = 0;
          pointer.carriedBoost = 0;
          pointer.samples = [{time:at,x:pointer.x}];
        }
      }
      pointer.x = sample.clientX;
      pointer.moved += Math.abs(delta);
      pointer.lastMoveAt = now;
      if (dragDirection === direction) pointer.distance += Math.abs(delta) * dragSensitivity;
      pointer.samples.push({time:at,x:pointer.x});
      position = wrap(position + delta * dragSensitivity);
    }
    while (pointer.samples.length > 2 && pointer.samples[1].time < now - 80) pointer.samples.shift();
    draw();
  });

  function releasePointer(event, cancelled = false) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const current = pointer;
    if (!cancelled) {
      const now = performance.now();
      const tap = current.type === 'mouse'
        ? now - current.startTime <= 500 && current.moved <= 6
        : now - current.startTime <= 280 && current.moved <= 12 &&
          Math.abs(current.x - current.startX) < 2;
      if (tap) {
        const bounds = (phone.matches ? gesture : root)?.getBoundingClientRect?.() ||
          {left:0,right:window.innerWidth || innerWidth};
        setDirection(current.startX < (bounds.left + bounds.right) / 2 ? -1 : 1);
        clearReleaseMotion();
        tapBoost = current.type === 'mouse' ? mouseClickImpulse : tapImpulse;
        tapBoostDecay = current.type === 'mouse' ? mouseClickDecay : tapDecay;
      } else {
        startCoast(current, now);
      }
    } else {
      clearReleaseMotion();
    }
    pointer = null;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    wake();
  }

  root.addEventListener('pointerup', event => releasePointer(event));
  root.addEventListener('pointercancel', event => releasePointer(event, true));
  root.addEventListener('lostpointercapture', event => releasePointer(event, true));

  root.addEventListener('wheel', event => {
    if (isControlTarget(event.target)) return;
    if (event.cancelable) event.preventDefault();
    const delta = event.deltaX && Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? -event.deltaX
      : event.deltaY;
    if (!delta) return;
    clearReleaseMotion();
    heldKey = null;
    setDirection(Math.sign(delta));
    const trackpadLike = event.deltaMode === 0 &&
      Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) < 80;
    position = wrap(position + delta * (trackpadLike ? trackpadWheelSensitivity : wheelSensitivity));
    draw();
  }, {passive:false});

  window.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    if (pointer || heldKey === event.key) return;
    clearReleaseMotion();
    setDirection(event.key === 'ArrowRight' ? 1 : -1);
    heldKey = event.key;
    heldKeySince = performance.now();
    wake();
  });

  window.addEventListener('keyup', event => {
    if (heldKey !== event.key) return;
    event.preventDefault();
    const heldSeconds = Math.max(0, (performance.now() - heldKeySince) / 1000);
    const speed = Math.min(keyMaxVelocity,
      keyInitialVelocity + heldSeconds * keyAcceleration);
    heldKey = null;
    coastBoost = speed - idleVelocity;
    coastDecay = tapDecay;
    wake();
  });

  window.addEventListener('resize', () => {
    load();
    draw(true);
  });

  window.addEventListener('blur', pause);
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else resume();
  });

  for (const query of [phone, largeScreen]) {
    if (query.addEventListener) query.addEventListener('change', load);
    else if (query.addListener) query.addListener(load);
  }

  load();
})();
