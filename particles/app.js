(() => {
  'use strict';

  const { WIDTH, HEIGHT, shortest, wrap } = ParticleWorld;
  const { SEED, STAGES } = ParticleReplay;
  const get = id => document.getElementById(id);
  const canvas = get('world');
  const context = canvas.getContext('2d');
  const seed = get('seed');
  const speed = get('speed');
  const play = get('play');
  const field = get('field');
  const status = get('status');
  const counts = get('counts');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const format = new Intl.NumberFormat();
  const brushes = [
    ['#9ba99b', 0.19], ['#668476', 0.23], ['#365f51', 0.28], ['#9b6c52', 0.29],
    ['#0a6557', 0.33], ['#a64a27', 0.33], ['#435f9d', 0.33],
  ];
  let stage;
  let frame;
  let focusX;
  let focusY;
  let viewWidth;
  let endAt;
  let playing;
  let wide;
  let revision = 0;
  let worker;
  let runLocal;
  let pending;
  let failed = false;
  let lastDispatch = 0;

  function setPlaying(value) {
    playing = value;
    play.textContent = playing ? 'Pause' : 'Play';
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    if (frame) draw(frame);
  }

  function draw(data) {
    const { width, height } = canvas;
    const { points, density, marked, groups } = data;
    if (!width || !height) return;
    if (stage && !wide && groups.length) {
      const origin = groups[0];
      const x = wrap(origin.x + groups.reduce((n, g) => n + shortest(g.x - origin.x, WIDTH), 0) / groups.length, WIDTH);
      const y = wrap(origin.y + groups.reduce((n, g) => n + shortest(g.y - origin.y, HEIGHT), 0) / groups.length, HEIGHT);
      focusX = wrap(focusX + shortest(x - focusX, WIDTH) * 0.22, WIDTH);
      focusY = wrap(focusY + shortest(y - focusY, HEIGHT) * 0.22, HEIGHT);
    }
    const scale = wide ? Math.min(width / WIDTH, height / HEIGHT) : width / viewWidth;
    const maxRadius = 3.2 * Math.min(devicePixelRatio, 2);
    const paths = brushes.map(() => new Path2D());
    for (let id = 0; id < density.length; id++) {
      const x = width / 2 + shortest(points[2 * id] - focusX, WIDTH) * scale;
      const y = height / 2 + shortest(points[2 * id + 1] - focusY, HEIGHT) * scale;
      if (x < -maxRadius || x > width + maxRadius || y < -maxRadius || y > height + maxRadius) continue;
      const n = density[id];
      const brush = marked[id] ? 3 + marked[id] : n >= 34 ? 3 : n >= 16 ? 2 : n >= 12 ? 1 : 0;
      const path = paths[brush];
      const radius = Math.max(0.85, Math.min(maxRadius, brushes[brush][1] * scale));
      path.moveTo(x + radius, y);
      path.arc(x, y, radius, 0, 2 * Math.PI);
    }
    context.clearRect(0, 0, width, height);
    for (let i = 0; i < brushes.length; i++) {
      context.fillStyle = brushes[i][0];
      context.fill(paths[i]);
    }
  }

  function update(data) {
    const count = stage && data.groups.length
      ? data.groups.map(group => format.format(group.size)).join(' + ') + ' tracked particles'
      : format.format(data.divisions) + (data.divisions === 1 ? ' verified division' : ' verified divisions');
    counts.textContent = 'Step ' + format.format(data.tick) + ' · ' + count;
    let text = 'The particles are moving from a random scatter';
    if (stage) {
      if (data.tick < stage.start) text = 'Advancing the random start to step ' + format.format(stage.start);
      else if (data.verified) text = 'Division verified at step ' + format.format(stage.watch.split);
      else if (data.tick >= stage.watch.split) text = stage.after;
      else text = stage.before;
    }
    if (status.textContent !== text) status.textContent = text;
  }

  function receive(data) {
    if (!data || data.revision !== revision) return;
    pending = false;
    frame = data;
    if (frame.tick >= endAt) {
      setPlaying(false);
      endAt = Infinity;
    }
    draw(data);
    update(data);
  }

  function showError() {
    failed = true;
    setPlaying(false);
    status.textContent = 'The simulation could not start. Reload the page to try again.';
  }

  function send(message) {
    pending = true;
    const data = { ...message, revision };
    if (worker) {
      worker.postMessage(data);
    } else {
      setTimeout(() => {
        if (data.revision !== revision) return;
        try {
          receive(runLocal(data));
        } catch {
          showError();
        }
      }, 0);
    }
  }

  function camera(wideView) {
    wide = wideView;
    focusX = wide ? WIDTH / 2 : stage.x;
    focusY = wide ? HEIGHT / 2 : stage.y;
    viewWidth = wide ? WIDTH : stage.width;
    field.setAttribute('aria-pressed', String(wide));
    if (frame) draw(frame);
  }

  function start(key, randomSeed, autoplay) {
    stage = STAGES[key];
    seed.value = randomSeed;
    frame = null;
    revision++;
    endAt = stage?.end ?? Infinity;
    for (const id of Object.keys(STAGES)) get(id).setAttribute('aria-pressed', String(id === key));
    field.disabled = !stage;
    camera(!stage);
    setPlaying(autoplay);
    failed = false;
    const url = new URL(location.href);
    if (stage) url.searchParams.set('replay', key);
    else url.searchParams.delete('replay');
    url.searchParams.set('seed', randomSeed);
    try {
      history.replaceState(null, '', url);
    } catch {
      // Preview frames can restrict history updates.
    }
    send({ type: 'start', seed: randomSeed, watch: stage?.watch });
  }

  function loop(now) {
    if (frame && !pending && !failed) {
      if (stage && frame.tick < stage.start) {
        send({ type: 'advance', steps: 200, until: stage.start });
      } else if (playing && now - lastDispatch >= 1000 / 30) {
        lastDispatch = now;
        send({ type: 'advance', steps: Number(speed.value) / 30, until: endAt });
      }
    }
    requestAnimationFrame(loop);
  }

  const query = new URLSearchParams(location.search);
  const requested = query.get('replay');
  const key = Object.hasOwn(STAGES, requested) ? requested : null;
  const rawSeed = query.get('seed');
  const randomSeed = key || !/^\d{1,10}$/.test(rawSeed) || Number(rawSeed) > 4294967295 ? SEED : Number(rawSeed);
  function useLocal() {
    worker?.terminate();
    worker = null;
    runLocal = makeParticleRunner(11);
  }
  try {
    worker = new Worker(new URL('./worker.js', document.currentScript.src));
    worker.onmessage = ({ data }) => receive(data);
    worker.onerror = () => {
      useLocal();
      const selected = Object.keys(STAGES).find(id => STAGES[id] === stage);
      start(selected, seed.valueAsNumber, playing);
    };
  } catch {
    useLocal();
  }

  for (const id of Object.keys(STAGES)) get(id).addEventListener('click', () => start(id, SEED, true));
  get('seeds').addEventListener('submit', event => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) start(null, seed.valueAsNumber, true);
  });
  field.addEventListener('click', () => camera(!wide));
  play.addEventListener('click', () => setPlaying(!playing));
  motion.addEventListener('change', event => { if (event.matches) setPlaying(false); });
  new ResizeObserver(resize).observe(canvas);
  resize();
  start(key, randomSeed, !motion.matches);
  requestAnimationFrame(loop);
})();
