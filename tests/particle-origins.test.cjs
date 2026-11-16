const assert = require('node:assert/strict');
const { once } = require('node:events');
const { join } = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { Worker } = require('node:worker_threads');
require('../particles/engine.js');
require('../particles/observe.js');
require('../particles/replay.js');

const { World, WIDTH, HEIGHT, COUNT, shortest } = ParticleWorld;
const { Lineages, SAMPLE_INTERVAL } = ParticleObserver;
const { SEED, STAGES } = ParticleReplay;

test('an unassembled founder gives rise to a daughter which divides independently', () => {
  const world = new World(SEED);
  const unobserved = new World(SEED);
  const lineages = new Lineages();
  const first = STAGES.first.watch;
  const second = STAGES.daughter.watch;
  const founderId = first.groups[0].id;
  const daughterId = second.groups[0].id;
  lineages.sample(world);
  assert.equal(lineages.tracks.has(founderId), false);
  let atFirstSplit;
  let looseParticles = 0;
  for (let tick = 1; tick <= STAGES.daughter.end; tick++) {
    world.step();
    unobserved.step();
    if (tick % SAMPLE_INTERVAL !== 0) continue;
    lineages.sample(world);
    if (tick === 8) assert.equal(lineages.tracks.get(founderId).members.length, 13);
    if (tick === first.split) atFirstSplit = lineages.previousByParticle.slice();
    if (tick === second.split) {
      for (const { id } of second.groups) {
        const group = lineages.tracks.get(id);
        looseParticles += group.members.filter(member => !atFirstSplit[member]).length;
      }
    }
  }
  const opening = lineages.births.find(event => event.tick === first.split && event.parent === founderId);
  const later = lineages.births.find(event => event.tick === second.split && event.parent === daughterId);
  assert.ok(opening);
  assert.ok(later);
  assert.deepEqual(opening.children, first.groups.map(group => group.id));
  assert.deepEqual(later.children, second.groups.map(group => group.id));
  assert.equal(later.lastJoin, -Infinity);
  assert.ok(later.tick > opening.confirmed);
  assert.ok(looseParticles >= 50);

  // Attaching the observer cannot affect the motion or the number of particles.
  assert.equal(world.x.length, COUNT);
  assert.deepEqual(world.x, unobserved.x);
  assert.deepEqual(world.y, unobserved.y);
  assert.deepEqual(world.vx, unobserved.vx);
  assert.deepEqual(world.vy, unobserved.vy);
});

test('both two-kind behaviours can divide from a random scatter', () => {
  for (const [model, seed] of [['speeds', 69], ['pursuit', 17]]) {
    const world = new World(seed, model);
    const lineages = new Lineages();
    lineages.sample(world);
    assert.equal(world.kind.filter(kind => kind === 1).length, COUNT / 2);

    const x = world.x.slice();
    const y = world.y.slice();
    world.step();
    for (let id = 0; id < COUNT; id++) {
      const distance = Math.hypot(shortest(world.x[id] - x[id], WIDTH), shortest(world.y[id] - y[id], HEIGHT));
      const expected = model === 'pursuit' ? 0.67 : world.kind[id] ? 0.77 : 0.60;
      assert.ok(Math.abs(distance - expected) < 1e-11);
    }

    while (world.tick < 600 && !lineages.births.length) {
      world.step();
      if (world.tick % SAMPLE_INTERVAL === 0) lineages.sample(world);
    }
    assert.ok(lineages.births.length > 0, model);
  }
});

test('arrangements change initial positions while using the same random headings', () => {
  const scattered = new World(69);
  for (const arrangement of ['bands', 'clouds']) {
    const shaped = new World(69, 'classic', arrangement);
    assert.notDeepEqual(shaped.y, scattered.y);
    assert.deepEqual(shaped.vx, scattered.vx);
    assert.deepEqual(shaped.vy, scattered.vy);
    assert.ok(shaped.x.every(x => x >= 0 && x < WIDTH));
    assert.ok(shaped.y.every(y => y >= 0 && y < HEIGHT));
  }
});

test('uncapped advances in the worker between frame requests and can pause', { timeout: 5000 }, async t => {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { resolve } = require('node:path');
    globalThis.importScripts = (...files) => files.forEach(file => require(resolve(workerData, file)));
    globalThis.self = { postMessage: (state, transfers) => parentPort.postMessage(state, transfers) };
    require(resolve(workerData, 'worker.js'));
    parentPort.on('message', data => self.onmessage({ data }));
  `, { eval: true, workerData: join(__dirname, '..', 'particles') });
  t.after(() => worker.terminate());

  async function send(message) {
    const response = once(worker, 'message');
    worker.postMessage({ revision: 1, ...message });
    return (await response)[0];
  }

  const initial = await send({ type: 'start', seed: 69, model: 'pursuit', arrangement: 'bands', runTo: Infinity });
  assert.equal(initial.tick, 0);
  assert.equal(initial.kinds.filter(kind => kind === 1).length, COUNT / 2);
  await delay(300);
  const paused = await send({ type: 'pace', runTo: null });
  assert.ok(paused.tick > initial.tick);
  await delay(90);
  const stillPaused = await send({ type: 'frame', steps: 0, until: Infinity });
  assert.equal(stillPaused.tick, paused.tick);
  const stepped = await send({ type: 'frame', steps: 3, until: Infinity });
  assert.equal(stepped.tick, paused.tick + 3);
});
