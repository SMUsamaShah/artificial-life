const assert = require('node:assert/strict');
const test = require('node:test');
require('../particles/engine.js');
require('../particles/observe.js');
require('../particles/replay.js');

const { World, COUNT } = ParticleWorld;
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
