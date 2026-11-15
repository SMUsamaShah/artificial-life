const assert = require('node:assert/strict');
const test = require('node:test');
require('../bff.js');
require('../physarum/soup.js');
require('../physarum/worker.js');

const { ParticleSoup, testReplication, KNOWN_REPLICATOR, POPULATION } = ParticleLife;

test('the assay follows the copying tape for five generations', () => {
  const result = testReplication(KNOWN_REPLICATOR, 1);
  assert.deepEqual(Array.from(result.parent), Array.from(KNOWN_REPLICATOR));
  assert.deepEqual(Array.from(result.child), Array.from(KNOWN_REPLICATOR));
  const inertTape = new Uint8Array(BFF.TAPE_SIZE).fill(32);
  inertTape[0] = '.'.charCodeAt(0);
  assert.equal(testReplication(inertTape, 1), null);
});

test('random starts use identical tapes across movement modes', () => {
  const trail = new ParticleSoup({ seed: 1, movement: 'trail', start: 'random' });
  const drift = new ParticleSoup({ seed: 1, movement: 'drift', start: 'random' });
  assert.deepEqual(trail.bytes, drift.bytes);
  assert.notDeepEqual(trail.field, drift.field);
  assert.equal(trail.carrierCount, 0);
  assert.equal(drift.carrierCount, 0);
  assert.ok(trail.tapes.every(tape => !Buffer.from(tape).equals(KNOWN_REPLICATOR)));
});

test('the seeded control copies into nearby carriers in each movement mode', () => {
  for (const movement of ['trail', 'drift', 'heritable']) {
    const soup = new ParticleSoup({ seed: 1, movement, start: 'known' });
    const initialCount = soup.carrierCount;
    assert.equal(initialCount, 6);
    while (soup.encounters < 100000) soup.step();
    assert.ok(soup.carrierCount > initialCount, movement);
    assert.equal(soup.occupancy.filter(id => id !== -1).length, POPULATION);
    assert.equal(soup.tapes.length, POPULATION);
  }
});

test('the last tape byte changes motion in the heritable mode', () => {
  const settings = { seed: 3, movement: 'heritable', start: 'random' };
  const weak = new ParticleSoup(settings);
  const strong = new ParticleSoup(settings);
  assert.deepEqual(weak.x, strong.x);
  for (const tape of weak.tapes) tape[BFF.TAPE_SIZE - 1] = 0;
  for (const tape of strong.tapes) tape[BFF.TAPE_SIZE - 1] = 255;
  weak.move();
  strong.move();
  assert.notDeepEqual(weak.heading, strong.heading);
});

test('the runner rejects advance messages from an older simulation', () => {
  const run = createParticleRunner(100);
  const options = { seed: 1, movement: 'trail', start: 'known' };
  assert.equal(run({ type: 'reset', version: 1, options }).state.encounters, 0);
  assert.equal(run({ type: 'reset', version: 2, options }).state.encounters, 0);
  assert.equal(run({ type: 'advance', version: 1, steps: 3 }), null);
  assert.ok(run({ type: 'advance', version: 2, steps: 3 }).state.encounters > 0);
});
