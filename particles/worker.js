(() => {
  'use strict';

  const inWorker = typeof importScripts === 'function';
  if (inWorker) importScripts('./engine.js', './observe.js');

  function makeRunner(budgetMs) {
    const { World, COUNT } = ParticleWorld;
    const { Lineages, SAMPLE_INTERVAL } = ParticleObserver;
    let world;
    let lineages;
    let revision;
    let watch;

    return message => {
      if (message.type === 'start') {
        revision = message.revision;
        watch = message.watch;
        world = new World(message.seed);
        lineages = new Lineages();
        lineages.sample(world);
      } else if (message.type === 'advance' && world && message.revision === revision) {
        const deadline = performance.now() + budgetMs;
        const target = Math.min(message.until, world.tick + message.steps);
        while (world.tick < target && performance.now() < deadline) {
          world.step();
          if (world.tick % SAMPLE_INTERVAL === 0) lineages.sample(world);
        }
      } else {
        return null;
      }

      const points = new Float32Array(2 * COUNT);
      const density = new Uint8Array(COUNT);
      const marked = new Uint8Array(COUNT);
      for (let id = 0; id < COUNT; id++) {
        points[2 * id] = world.x[id];
        points[2 * id + 1] = world.y[id];
        density[id] = Math.min(world.density[id], 255);
      }

      const groups = [];
      if (watch) {
        const tracked = world.tick < watch.split ? [watch.groups[0]] : watch.groups;
        for (const { id, color } of tracked) {
          const group = lineages.tracks.get(id);
          if (!group) continue;
          for (const member of group.members) marked[member] = color;
          groups.push({ x: group.x, y: group.y, size: group.members.length });
        }
      }
      return {
        revision, points, density, marked, groups,
        tick: world.tick, divisions: lineages.births.length,
        verified: watch && lineages.births.some(event =>
          event.tick === watch.split && event.parent === watch.groups[0].id
        ),
      };
    };
  }

  if (inWorker) {
    const run = makeRunner(19);
    self.onmessage = ({ data }) => {
      const response = run(data);
      if (response) self.postMessage(response, [
        response.points.buffer,
        response.density.buffer,
        response.marked.buffer,
      ]);
    };
  } else {
    globalThis.makeParticleRunner = makeRunner;
  }
})();
