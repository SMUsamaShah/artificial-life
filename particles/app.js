(() => {
  'use strict';

  const { WIDTH, HEIGHT, MODELS, ARRANGEMENTS, shortest, wrap } = ParticleWorld;
  const { SEED, STAGES } = ParticleReplay;
  const get = id => document.getElementById(id);
  const canvas = get('world');
  const context = canvas.getContext('2d');
  const settings = get('seeds');
  const seed = get('seed');
  const model = get('model');
  const arrangement = get('arrangement');
  const speed = get('speed');
  const play = get('play');
  const field = get('field');
  const status = get('status');
  const counts = get('counts');
  const legend = get('kinds');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const format = new Intl.NumberFormat();
  const brushes = [
    ['#9ba99b', 0.19], ['#668476', 0.23], ['#365f51', 0.28], ['#9b6c52', 0.29],
    ['#0a6557', 0.33], ['#a64a27', 0.33], ['#435f9d', 0.33],
  ];
  const kindBrushes = [
    ['#769d91', 0.20], ['#226e60', 0.31],
    ['#bc9477', 0.20], ['#a4552d', 0.31],
  ];
  let stage;
  let frame;
  let focusX;
  let focusY;
  let viewWidth;
  let endAt;
  let playing;
  let wide;
  let kinds;
  let showKinds;
  let revision = 0;
  let worker;
  let runLocal;
  let pending;
  let failed = false;
  let lastDispatch = 0;
  let rateSample;
  let stepRate;

  function setPlaying(value) {
    playing = value;
    play.textContent = playing ? 'Pause' : 'Play';
    rateSample = null;
    stepRate = null;
  }

  function freeRunTarget() {
    if (!playing) return null;
    if (speed.value === 'uncapped') return endAt;
    if (stage && (frame?.tick ?? 0) < stage.start) return stage.start;
    return null;
  }

  function changePace() {
    send({ type: 'pace', runTo: freeRunTarget() });
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
    const palette = showKinds ? kindBrushes : brushes;
    const paths = palette.map(() => new Path2D());
    for (let id = 0; id < density.length; id++) {
      const x = width / 2 + shortest(points[2 * id] - focusX, WIDTH) * scale;
      const y = height / 2 + shortest(points[2 * id + 1] - focusY, HEIGHT) * scale;
      if (x < -maxRadius || x > width + maxRadius || y < -maxRadius || y > height + maxRadius) continue;
      const n = density[id];
      const brush = showKinds
        ? 2 * kinds[id] + Number(n >= 16)
        : marked[id] ? 3 + marked[id] : n >= 34 ? 3 : n >= 16 ? 2 : n >= 12 ? 1 : 0;
      const path = paths[brush];
      const radius = Math.max(0.85, Math.min(maxRadius, palette[brush][1] * scale));
      path.moveTo(x + radius, y);
      path.arc(x, y, radius, 0, 2 * Math.PI);
    }
    context.clearRect(0, 0, width, height);
    for (let i = 0; i < palette.length; i++) {
      context.fillStyle = palette[i][0];
      context.fill(paths[i]);
    }
  }

  function update(data) {
    const time = performance.now();
    if (playing && !rateSample) rateSample = { tick: data.tick, time };
    if (rateSample && time - rateSample.time >= 650) {
      stepRate = Math.round(1000 * (data.tick - rateSample.tick) / (time - rateSample.time));
      rateSample = { tick: data.tick, time };
    }
    const count = stage && data.groups.length
      ? data.groups.map(group => format.format(group.size)).join(' + ') + ' tracked particles'
      : format.format(data.divisions) + (data.divisions === 1 ? ' verified division' : ' verified divisions');
    const rate = stepRate === null ? '' : ' · ' + format.format(stepRate) + ' steps/s';
    counts.textContent = 'Step ' + format.format(data.tick) + ' · ' + count + rate;
    let text = playing ? 'World running' : 'World paused';
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
    if (data.requested) pending = false;
    if (data.kinds) kinds = data.kinds;
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
    if (message.type === 'start' || message.type === 'frame') pending = true;
    const data = { ...message, revision };
    if (worker) {
      worker.postMessage(data);
    } else {
      queueMicrotask(() => {
        if (data.revision !== revision) return;
        try {
          runLocal(data);
        } catch {
          showError();
        }
      });
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

  function writeAddress() {
    const url = new URL(location.href);
    const key = Object.keys(STAGES).find(id => STAGES[id] === stage);
    if (key) url.searchParams.set('replay', key);
    else url.searchParams.delete('replay');
    url.searchParams.set('seed', seed.value);
    for (const [name, value, fallback] of [
      ['model', model.value, 'classic'],
      ['arrangement', arrangement.value, 'scatter'],
      ['speed', speed.value, '30'],
    ]) {
      if (value === fallback) url.searchParams.delete(name);
      else url.searchParams.set(name, value);
    }
    try {
      history.replaceState(null, '', url);
    } catch {
      // Preview frames can restrict history updates.
    }
  }

  function start(key, randomSeed, autoplay) {
    stage = STAGES[key];
    if (stage) {
      model.value = 'classic';
      arrangement.value = 'scatter';
    }
    const labels = MODELS[model.value].types;
    showKinds = labels.length !== 0;
    legend.hidden = !showKinds;
    legend.replaceChildren(...labels.map((label, index) => {
      const name = document.createElement('span');
      name.textContent = label;
      name.style.setProperty('--swatch', kindBrushes[2 * index + 1][0]);
      return name;
    }));
    seed.value = randomSeed;
    frame = null;
    revision++;
    endAt = stage?.end ?? Infinity;
    for (const id of Object.keys(STAGES)) get(id).setAttribute('aria-pressed', String(id === key));
    field.disabled = !stage;
    camera(!stage);
    setPlaying(autoplay);
    failed = false;
    writeAddress();
    send({
      type: 'start', seed: randomSeed, watch: stage?.watch, model: model.value,
      arrangement: arrangement.value, runTo: freeRunTarget(),
    });
  }

  function loop(now) {
    if (playing && frame && !pending && !failed && now - lastDispatch >= 1000 / 30) {
      lastDispatch = now;
      const steps = freeRunTarget() === null ? Number(speed.value) / 30 : 0;
      send({ type: 'frame', steps, until: endAt });
    }
    requestAnimationFrame(loop);
  }

  const query = new URLSearchParams(location.search);
  const requested = query.get('replay');
  const key = Object.hasOwn(STAGES, requested) ? requested : null;
  const rawSeed = query.get('seed');
  const randomSeed = key || !/^\d{1,10}$/.test(rawSeed) || Number(rawSeed) > 4294967295 ? SEED : Number(rawSeed);
  if (Object.hasOwn(MODELS, query.get('model'))) model.value = query.get('model');
  if (ARRANGEMENTS.includes(query.get('arrangement'))) arrangement.value = query.get('arrangement');
  if (['30', '90', '360', 'uncapped'].includes(query.get('speed'))) speed.value = query.get('speed');

  function useLocal() {
    worker?.terminate();
    worker = null;
    runLocal = makeParticleEndpoint(receive, 8);
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
  function restart(autoplay) {
    if (settings.reportValidity()) start(null, seed.valueAsNumber, autoplay);
  }

  settings.addEventListener('submit', event => {
    event.preventDefault();
    restart(true);
  });
  model.addEventListener('change', () => restart(playing));
  arrangement.addEventListener('change', () => restart(playing));
  field.addEventListener('click', () => camera(!wide));
  play.addEventListener('click', () => {
    setPlaying(!playing);
    changePace();
  });
  speed.addEventListener('change', () => {
    rateSample = null;
    stepRate = null;
    writeAddress();
    changePace();
  });
  motion.addEventListener('change', event => {
    if (event.matches) {
      setPlaying(false);
      changePace();
    }
  });
  new ResizeObserver(resize).observe(canvas);
  resize();
  start(key, randomSeed, !motion.matches);
  requestAnimationFrame(loop);
})();
