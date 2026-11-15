(() => {
  'use strict';

  const canvas = document.getElementById('soup');
  const ctx = canvas.getContext('2d');
  const trailCanvas = document.createElement('canvas');
  const trailCtx = trailCanvas.getContext('2d');
  const form = document.getElementById('controls');
  const movement = document.getElementById('movement');
  const start = document.getElementById('start');
  const seed = document.getElementById('seed');
  const mutation = document.getElementById('mutation');
  const speed = document.getElementById('speed');
  const play = document.getElementById('play');
  const restart = document.getElementById('restart');
  const carriers = document.getElementById('carriers');
  const encounters = document.getElementById('encounters');
  const result = document.getElementById('result');
  const program = document.getElementById('program');
  const programDetail = document.getElementById('program-detail');
  const number = new Intl.NumberFormat();
  const steps = { normal: 1, fast: 4, turbo: 128 };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let pixels;
  let playing = !reducedMotion.matches;
  let pending = false;
  let failed = false;
  let version = 0;
  let lastFrame = 0;
  let worker;
  let localRun;

  function setPlaying(state) {
    playing = state;
    play.textContent = playing ? 'Pause' : 'Play';
  }

  function showError() {
    failed = true;
    play.disabled = true;
    restart.disabled = true;
    result.textContent = 'The simulation could not start. Reload to try again.';
  }

  function draw(state) {
    const { width, height, trail, points, carriers: matches } = state;
    if (!pixels) {
      trailCanvas.width = width;
      trailCanvas.height = height;
      pixels = trailCtx.createImageData(width, height);
    }
    const data = pixels.data;
    for (let i = 0; i < trail.length; i++) {
      const level = trail[i];
      const offset = 4 * i;
      data[offset] = 73 + level * 0.52;
      data[offset + 1] = 128 + level * 0.43;
      data[offset + 2] = 104 + level * 0.38;
      data[offset + 3] = level;
    }
    trailCtx.putImageData(pixels, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(trailCanvas, 0, 0, canvas.width, canvas.height);

    const scale = canvas.width / width;
    ctx.fillStyle = 'rgba(174, 206, 184, .26)';
    for (let i = 0; i < matches.length; i++) {
      if (!matches[i]) ctx.fillRect(points[2 * i] * scale, points[2 * i + 1] * scale, 1.6, 1.6);
    }
    ctx.fillStyle = '#f7bc76';
    ctx.beginPath();
    for (let i = 0; i < matches.length; i++) {
      if (!matches[i]) continue;
      const x = points[2 * i] * scale;
      const y = points[2 * i + 1] * scale;
      ctx.moveTo(x + 2.6, y);
      ctx.arc(x, y, 2.6, 0, 2 * Math.PI);
    }
    ctx.fill();
  }

  function updateReadout(state) {
    carriers.textContent = number.format(state.carrierCount);
    encounters.textContent = number.format(state.encounters);
    let message = start.value === 'known' ? 'Known replicator seeded' : 'Searching for a replicator';
    if (state.discovery) {
      const discovery = state.discovery;
      const count = number.format(discovery.encounters);
      message = discovery.presentInitially
        ? 'Initial replicator verified after ' + count + ' encounters'
        : 'New replicator verified after ' + count + ' encounters';
      program.textContent = discovery.program;
      programDetail.hidden = false;
    }
    if (result.textContent !== message) result.textContent = message;
  }

  function reset() {
    if (failed || !form.reportValidity()) return;
    version++;
    pending = true;
    result.textContent = 'Starting simulation';
    carriers.textContent = '0';
    encounters.textContent = '0';
    programDetail.hidden = true;
    programDetail.open = false;
    const options = {
      movement: movement.value,
      start: start.value,
      seed: seed.valueAsNumber,
      mutationRate: mutation.value === 'off' ? 0 : 0.00024,
    };
    const url = new URL(location.href);
    url.searchParams.set('movement', options.movement);
    url.searchParams.set('start', options.start);
    url.searchParams.set('seed', options.seed);
    url.searchParams.set('mutation', mutation.value);
    try {
      history.replaceState(null, '', url);
    } catch {
      // The simulation can also run in previews that restrict history updates.
    }
    send({ type: 'reset', version, options });
  }

  function frame(now) {
    const batch = steps[speed.value];
    const interval = batch === steps.turbo ? 0 : 1000 / 30;
    if (playing && !pending && now - lastFrame >= interval) {
      pending = true;
      lastFrame = now;
      send({ type: 'advance', version, steps: batch });
    }
    if (!failed) requestAnimationFrame(frame);
  }

  const query = new URLSearchParams(location.search);
  const requestedSeed = query.get('seed');
  const requestedMovement = query.get('movement');
  seed.value = /^\d{1,10}$/.test(requestedSeed) && Number(requestedSeed) <= 4294967295
    ? Number(requestedSeed)
    : 1;
  if (['trail', 'drift', 'heritable'].includes(requestedMovement)) movement.value = requestedMovement;
  if (query.get('start') === 'known') start.value = 'known';
  if (query.get('mutation') === 'off') mutation.value = 'off';
  if (Object.hasOwn(steps, query.get('speed'))) speed.value = query.get('speed');

  function receive(data) {
    if (!data || data.version !== version) return;
    pending = false;
    draw(data.state);
    updateReadout(data.state);
  }

  function send(message) {
    if (worker) {
      worker.postMessage(message);
    } else {
      setTimeout(() => {
        if (message.version !== version) return;
        try {
          receive(localRun(message));
        } catch {
          showError();
        }
      }, 0);
    }
  }

  function startLocal() {
    worker?.terminate();
    worker = null;
    localRun = createParticleRunner(10);
  }

  try {
    worker = new Worker(new URL('./worker.js', document.currentScript.src));
    worker.onmessage = ({ data }) => receive(data);
    worker.onerror = () => {
      startLocal();
      reset();
    };
  } catch {
    startLocal();
  }
  form.addEventListener('submit', event => { event.preventDefault(); reset(); });
  movement.addEventListener('change', reset);
  start.addEventListener('change', reset);
  mutation.addEventListener('change', reset);
  play.addEventListener('click', () => setPlaying(!playing));
  reducedMotion.addEventListener('change', event => {
    if (event.matches) setPlaying(false);
  });

  setPlaying(playing);
  reset();
  requestAnimationFrame(frame);
})();
