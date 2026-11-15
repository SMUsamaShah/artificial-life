(() => {
  'use strict';

  const { WIDTH, HEIGHT, COUNT, RADIUS, shortest, wrap } = ParticleWorld;
  const SAMPLE_INTERVAL = 4;
  const CORE_NEIGHBORS = 12;
  const MIN_GROUP = 13;
  const LINK_RADIUS = 3.3;
  const STABLE_PARENT = 64;
  const STABLE_DAUGHTERS = 72;
  const SEPARATION_TIME = 16;

  function findGroups(world) {
    const unvisited = new Uint8Array(COUNT);
    for (let id = 0; id < COUNT; id++) {
      if (world.tick && world.density[id] < CORE_NEIGHBORS - 3) continue;
      let local = 0;
      world.visitNeighbors(id, RADIUS, () => local++);
      unvisited[id] = Number(local >= CORE_NEIGHBORS);
    }

    const groups = [];
    for (let root = 0; root < COUNT; root++) {
      if (!unvisited[root]) continue;
      const members = [root];
      unvisited[root] = 0;
      for (let i = 0; i < members.length; i++) {
        world.visitNeighbors(members[i], LINK_RADIUS, other => {
          if (!unvisited[other]) return;
          unvisited[other] = 0;
          members.push(other);
        });
      }
      if (members.length < MIN_GROUP) continue;
      let dx = 0;
      let dy = 0;
      const originX = world.x[root];
      const originY = world.y[root];
      for (const id of members) {
        dx += shortest(world.x[id] - originX, WIDTH);
        dy += shortest(world.y[id] - originY, HEIGHT);
      }
      const x = wrap(originX + dx / members.length, WIDTH);
      const y = wrap(originY + dy / members.length, HEIGHT);
      groups.push({ x, y, members });
    }
    return groups;
  }

  function apart(world, a, b) {
    for (const left of a.members) {
      for (const right of b.members) {
        const dx = shortest(world.x[right] - world.x[left], WIDTH);
        const dy = shortest(world.y[right] - world.y[left], HEIGHT);
        if (dx * dx + dy * dy <= RADIUS * RADIUS) return false;
      }
    }
    return true;
  }

  // An observer only reads particle state. Tracks and events are never
  // used to update a particle's position or heading.
  class Lineages {
    constructor() {
      this.tracks = new Map();
      this.previousByParticle = new Int32Array(COUNT);
      this.next = 1;
      this.pending = [];
      this.births = [];
    }

    sample(world) {
      const tick = world.tick;
      const groups = findGroups(world);
      const candidates = [];
      const children = new Map();
      for (const group of groups) {
        const overlap = new Map();
        for (const member of group.members) {
          const id = this.previousByParticle[member];
          if (id) overlap.set(id, (overlap.get(id) ?? 0) + 1);
        }
        let parent = 0;
        let shared = 0;
        for (const [id, count] of overlap) {
          if (count > shared) {
            parent = id;
            shared = count;
          }
        }
        group.joined = [...overlap].some(([id, count]) => {
          const source = this.tracks.get(id);
          return id !== parent && count >= 8 && count >= source.members.length * 0.25 &&
            tick - source.started >= STABLE_PARENT / 4;
        });
        if (shared < 8 || shared < group.members.length * 0.5) continue;
        candidates.push({ group, parent, shared });
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push({ group, shared });
      }
      candidates.sort((a, b) => b.shared - a.shared);

      const nextTracks = new Map();
      for (const { group, parent } of candidates) {
        if (nextTracks.has(parent)) continue;
        const previous = this.tracks.get(parent);
        group.id = parent;
        group.started = previous.started;
        group.initialSize = previous.initialSize;
        group.lastJoin = group.joined ? tick : previous.lastJoin;
        nextTracks.set(parent, group);
      }
      for (const group of groups) {
        if (group.id) continue;
        group.id = this.next++;
        group.started = tick;
        group.initialSize = group.members.length;
        group.lastJoin = group.joined ? tick : -Infinity;
        nextTracks.set(group.id, group);
      }

      for (const [parent, parts] of children) {
        const previous = this.tracks.get(parent);
        if (parts.length !== 2 || tick - Math.max(previous.started, previous.lastJoin) < STABLE_PARENT) continue;
        const [a, b] = parts;
        const size = previous.members.length;
        if (size < 2 * MIN_GROUP || a.shared + b.shared < size * 0.65) continue;
        this.pending.push({
          tick, parent, children: [a.group.id, b.group.id], size,
          daughterSizes: [a.group.members.length, b.group.members.length],
          x: previous.x, y: previous.y, started: previous.started,
          initialSize: previous.initialSize, lastJoin: previous.lastJoin, apartSince: null,
        });
      }

      this.pending = this.pending.filter(event => {
        const [a, b] = event.children.map(id => nextTracks.get(id));
        if (!a || !b || a.lastJoin >= event.tick || b.lastJoin >= event.tick) return false;
        event.apartSince = apart(world, a, b) ? (event.apartSince ?? tick) : null;
        if (tick - event.tick < STABLE_DAUGHTERS) return true;
        if (event.apartSince === null || tick - event.apartSince < SEPARATION_TIME) {
          return tick - event.tick < STABLE_DAUGHTERS * 2;
        }
        this.births.push({ ...event, confirmed: tick, confirmedSizes: [a.members.length, b.members.length] });
        return false;
      });

      this.previousByParticle.fill(0);
      for (const group of groups) {
        for (const id of group.members) this.previousByParticle[id] = group.id;
      }
      this.tracks = nextTracks;
    }
  }

  globalThis.ParticleObserver = { Lineages, SAMPLE_INTERVAL };
})();
