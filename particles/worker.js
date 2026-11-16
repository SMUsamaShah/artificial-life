(() => {
  'use strict';

  const inWorker = typeof importScripts === 'function';
  if (inWorker) importScripts('./engine.js', './observe.js');

  function makeEndpoint(publish, yieldEvery = 32) {
    const { World, COUNT } = ParticleWorld;
    const { Lineages, SAMPLE_INTERVAL } = ParticleObserver;
    let world;
    let lineages;
    let revision;
    let watch;
    let runTo = null;
    let queued = false;
    const tasks = [new MessageChannel(), new MessageChannel()];
    let nextChannel = 0;

    function advance(target) {
      while (world.tick < target) {
        world.step();
        if (world.tick % SAMPLE_INTERVAL === 0) lineages.sample(world);
      }
    }

    function runningFreely() {
      return runTo !== null && world.tick < runTo;
    }

    function queueWork() {
      if (queued || !runningFreely()) return;
      queued = true;
      // Alternate ports so a runtime that drains a ready port cannot keep
      // taking simulation work from that port ahead of control messages.
      tasks[nextChannel].port2.postMessage(null);
      nextChannel ^= 1;
    }

    // Yield for worker messages, then immediately queue more work. Snapshots
    // and animation frames never drive this loop.
    function pump() {
      queued = false;
      if (!runningFreely()) return;
      advance(Math.min(runTo, world.tick + yieldEvery));
      queueWork();
    }
    for (const { port1 } of tasks) port1.onmessage = pump;

    function snapshot(requested, includeKinds = false) {
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
      const state = {
        revision, requested, points, density, marked, groups,
        tick: world.tick, divisions: lineages.births.length,
        verified: watch && lineages.births.some(event =>
          event.tick === watch.split && event.parent === watch.groups[0].id
        ),
      };
      if (includeKinds) state.kinds = world.kind.slice();
      publish(state);
    }

    return message => {
      if (message.type === 'start') {
        revision = message.revision;
        watch = message.watch;
        world = new World(message.seed, message.model, message.arrangement);
        lineages = new Lineages();
        lineages.sample(world);
        runTo = message.runTo;
        snapshot(true, true);
        queueWork();
        return;
      }
      if (!world || message.revision !== revision) return;
      if (message.type === 'pace') {
        runTo = message.runTo;
        queueWork();
        if (runTo === null) snapshot(false);
      } else if (message.type === 'frame') {
        if (!runningFreely()) advance(Math.min(message.until, world.tick + message.steps));
        snapshot(true);
      }
    };
  }

  if (inWorker) {
    const handle = makeEndpoint(response => {
      const transfer = [
        response.points.buffer,
        response.density.buffer,
        response.marked.buffer,
      ];
      if (response.kinds) transfer.push(response.kinds.buffer);
      self.postMessage(response, transfer);
    });
    self.onmessage = ({ data }) => handle(data);
  } else {
    globalThis.makeParticleEndpoint = makeEndpoint;
  }
})();
