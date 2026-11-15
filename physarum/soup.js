(() => {
  'use strict';

  const { TAPE_SIZE, runTape, mutateBytes } = BFF;
  const WIDTH = 256;
  const HEIGHT = 148;
  const POPULATION = 4000;
  const TICKS_PER_EPOCH = 3;
  const CONTACT_RADIUS = 2.6;
  const CONTACT_CELLS = Math.ceil(CONTACT_RADIUS);
  const SENSOR_OFFSET = 7;
  const TURN = 0.52;
  const SPEED = 0.92;
  const DIAGONAL = Math.SQRT1_2;
  const INITIAL_CARRIERS = 6;
  const KNOWN_REPLICATOR = new TextEncoder().encode('[[{.>]-]' + ' '.repeat(48) + ']-]>.{[[');
  const opcodes = new Uint8Array(256);
  for (const op of '<>{}-+.,[]') opcodes[op.charCodeAt(0)] = op.charCodeAt(0);

  function makeRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function wrap(position, extent) {
    if (position < 0) return position + extent;
    if (position >= extent) return position - extent;
    return position;
  }

  function cellAt(x, y) {
    return (y | 0) * WIDTH + (x | 0);
  }

  function matches(tape, pattern) {
    for (let i = 0; i < TAPE_SIZE; i++) {
      if (pattern[i] !== -1 && tape[i] !== pattern[i]) return false;
    }
    return true;
  }

  // Follow independent five-generation lines, scoring positions shared by at
  // least half of the trials. The two halves can differ for alternating copies.
  function testReplication(candidate, seed) {
    if (!candidate.includes(44) && !candidate.includes(46)) return null;
    const random = makeRandom(seed);
    const pair = new Uint8Array(2 * TAPE_SIZE);
    const first = pair.subarray(0, TAPE_SIZE);
    const second = pair.subarray(TAPE_SIZE);
    const parentVotes = new Uint8Array(TAPE_SIZE);
    const lastChildren = [];
    for (let trial = 0; trial < 6; trial++) {
      second.set(candidate);
      for (let generation = 0; generation < 5; generation++) {
        first.set(second);
        for (let i = 0; i < TAPE_SIZE; i++) second[i] = random() * 256;
        runTape(pair);
      }
      for (let i = 0; i < TAPE_SIZE; i++) {
        if (first[i] === candidate[i]) parentVotes[i]++;
      }
      lastChildren.push(second.slice());
    }

    const parent = Int16Array.from(candidate, (value, i) => parentVotes[i] >= 3 ? value : -1);
    if (parent.filter(value => value >= 0).length < 48) return null;
    const child = new Int16Array(TAPE_SIZE).fill(-1);
    const childVotes = new Uint8Array(256);
    for (let i = 0; i < TAPE_SIZE; i++) {
      childVotes.fill(0);
      for (const tape of lastChildren) {
        const value = tape[i];
        if (++childVotes[value] >= 3) {
          child[i] = value;
          break;
        }
      }
    }
    if (child.filter(value => value >= 0).length < 48) return null;
    if (!child.includes(44) && !child.includes(46)) return null;
    return { parent, child };
  }

  class ParticleSoup {
    constructor({ seed, movement, start, mutationRate = 0 }) {
      this.seed = seed;
      this.movement = movement;
      this.motionRandom = makeRandom(seed ^ 0x17a7f90d);
      this.encounterRandom = makeRandom(seed ^ 0x53c218ae);
      this.mutationRandom = makeRandom(seed ^ 0x8f63dec2);
      this.mutationRate = mutationRate;
      const tapeRandom = makeRandom(seed);
      this.x = new Float64Array(POPULATION);
      this.y = new Float64Array(POPULATION);
      this.heading = new Float64Array(POPULATION);
      this.occupancy = new Int32Array(WIDTH * HEIGHT).fill(-1);
      this.field = new Float32Array(WIDTH * HEIGHT);
      this.blur = new Float32Array(WIDTH * HEIGHT);
      this.order = new Uint16Array(POPULATION);
      this.paired = new Uint8Array(POPULATION);
      this.candidates = new Uint16Array((2 * CONTACT_CELLS + 1) ** 2);
      this.carriers = new Uint8Array(POPULATION);
      const pair = new Uint8Array(2 * TAPE_SIZE);
      this.pair = pair;
      this.leftTape = pair.subarray(0, TAPE_SIZE);
      this.rightTape = pair.subarray(TAPE_SIZE);
      this.ticks = 0;
      this.epochs = 0;
      this.encounters = 0;
      this.activePatterns = null;
      this.carrierCount = 0;
      this.discovery = null;

      this.bytes = new Uint8Array(POPULATION * TAPE_SIZE);
      this.tapes = Array.from({ length: POPULATION }, (_, id) => {
        let x;
        let y;
        let cell;
        do {
          x = this.motionRandom() * WIDTH;
          y = this.motionRandom() * HEIGHT;
          cell = cellAt(x, y);
        } while (this.occupancy[cell] !== -1);
        this.x[id] = x;
        this.y[id] = y;
        this.heading[id] = this.motionRandom() * 2 * Math.PI;
        this.occupancy[cell] = id;
        this.order[id] = id;
        const tape = this.bytes.subarray(id * TAPE_SIZE, (id + 1) * TAPE_SIZE);
        for (let j = 0; j < TAPE_SIZE; j++) tape[j] = tapeRandom() * 256;
        return tape;
      });

      // Form the initial trail field before the first tape encounter.
      for (let i = 0; i < 105; i++) this.move();

      if (start === 'known') {
        const distance = id => (this.x[id] - 0.37 * WIDTH) ** 2 + (this.y[id] - HEIGHT / 2) ** 2;
        const nearby = Array.from(this.order).sort((a, b) => distance(a) - distance(b));
        for (const id of nearby.slice(0, INITIAL_CARRIERS)) this.tapes[id].set(KNOWN_REPLICATOR);
        this.activePatterns = { parent: KNOWN_REPLICATOR, child: KNOWN_REPLICATOR };
        this.markCarriers();
      }
      this.initialTapes = this.tapes.map(tape => tape.slice());
    }

    sample(x, y) {
      return this.field[cellAt(wrap(x, WIDTH), wrap(y, HEIGHT))];
    }

    move() {
      const { x, y, heading, occupancy, field, motionRandom, movement, tapes } = this;
      const drift = movement === 'drift';
      const inherited = movement === 'heritable';

      // Read one generation of the field before any arrivals deposit more trail.
      for (let id = 0; id < POPULATION; id++) {
        const angle = heading[id];
        let turn = (motionRandom() - 0.5) * 0.25;
        if (!drift) {
          const dx = SENSOR_OFFSET * Math.cos(angle);
          const dy = SENSOR_OFFSET * Math.sin(angle);
          const diagonalX = (dx - dy) * DIAGONAL;
          const diagonalY = (dx + dy) * DIAGONAL;
          const ahead = this.sample(x[id] + dx, y[id] + dy);
          const left = this.sample(x[id] + diagonalY, y[id] - diagonalX);
          const right = this.sample(x[id] + diagonalX, y[id] + diagonalY);
          if (left !== right && (left > ahead || right > ahead)) {
            const strength = inherited ? 0.20 + 1.60 * tapes[id][TAPE_SIZE - 1] / 255 : 1;
            turn += (left > right ? -TURN : TURN) * strength;
          }
        }
        heading[id] = angle + turn;
      }

      for (let id = 0; id < POPULATION; id++) {
        const from = cellAt(x[id], y[id]);
        const nextX = wrap(x[id] + SPEED * Math.cos(heading[id]), WIDTH);
        const nextY = wrap(y[id] + SPEED * Math.sin(heading[id]), HEIGHT);
        const to = cellAt(nextX, nextY);
        if (occupancy[to] !== -1 && occupancy[to] !== id) {
          heading[id] += (motionRandom() < 0.5 ? -1 : 1) * (0.5 + motionRandom() * 1.7);
          continue;
        }
        occupancy[from] = -1;
        occupancy[to] = id;
        x[id] = nextX;
        y[id] = nextY;
        field[to] += 4;
      }
      this.diffuse();
    }

    diffuse() {
      const { field, blur } = this;
      for (let y = 0; y < HEIGHT; y++) {
        const row = y * WIDTH;
        for (let x = 0; x < WIDTH; x++) {
          const left = row + wrap(x - 1, WIDTH);
          const right = row + wrap(x + 1, WIDTH);
          blur[row + x] = (field[left] + field[row + x] + field[right]) / 3;
        }
      }
      for (let y = 0; y < HEIGHT; y++) {
        const above = wrap(y - 1, HEIGHT) * WIDTH;
        const row = y * WIDTH;
        const below = wrap(y + 1, HEIGHT) * WIDTH;
        for (let x = 0; x < WIDTH; x++) {
          field[row + x] = 0.3 * (blur[above + x] + blur[row + x] + blur[below + x]);
        }
      }
    }

    pairNearby() {
      const { order, paired, occupancy, x, y, tapes, candidates, encounterRandom } = this;
      paired.fill(0);
      for (let i = order.length - 1; i > 0; i--) {
        const j = (encounterRandom() * (i + 1)) | 0;
        const a = order[i];
        order[i] = order[j];
        order[j] = a;
      }

      for (const a of order) {
        if (paired[a]) continue;
        const originX = x[a] | 0;
        const originY = y[a] | 0;
        let count = 0;
        for (let dy = -CONTACT_CELLS; dy <= CONTACT_CELLS; dy++) {
          const row = wrap(originY + dy, HEIGHT) * WIDTH;
          for (let dx = -CONTACT_CELLS; dx <= CONTACT_CELLS; dx++) {
            const b = occupancy[row + wrap(originX + dx, WIDTH)];
            if (b < 0 || b === a || paired[b]) continue;
            const rawX = Math.abs(x[a] - x[b]);
            const rawY = Math.abs(y[a] - y[b]);
            const sx = Math.min(rawX, WIDTH - rawX);
            const sy = Math.min(rawY, HEIGHT - rawY);
            if (sx * sx + sy * sy <= CONTACT_RADIUS ** 2) candidates[count++] = b;
          }
        }
        if (!count) continue;
        const b = candidates[(encounterRandom() * count) | 0];
        paired[a] = paired[b] = 1;
        this.leftTape.set(tapes[a]);
        this.rightTape.set(tapes[b]);
        const crossWrites = runTape(this.pair);
        tapes[a].set(this.leftTape);
        tapes[b].set(this.rightTape);
        this.encounters++;
        if (!this.activePatterns && crossWrites >= 32) {
          if (!this.track(this.leftTape)) this.track(this.rightTape);
        }
      }
    }

    markCarriers() {
      let count = 0;
      for (let id = 0; id < POPULATION; id++) {
        const tape = this.tapes[id];
        const carries = matches(tape, this.activePatterns.parent) || matches(tape, this.activePatterns.child);
        this.carriers[id] = Number(carries);
        count += carries;
      }
      this.carrierCount = count;
    }

    track(candidate) {
      const patterns = testReplication(candidate, this.seed ^ 0x2cc7c248);
      if (!patterns) return false;
      this.activePatterns = patterns;
      this.markCarriers();
      if (!this.discovery) {
        this.discovery = {
          encounters: this.encounters,
          epoch: this.epochs + 1,
          carriers: this.carrierCount,
          presentInitially: this.initialTapes.some(initial => matches(initial, patterns.parent)),
          program: Array.from(patterns.parent, value => {
            if (value === -1) return '?';
            return String.fromCharCode(opcodes[value] || (value === 0 ? 48 : 183));
          }).join(''),
        };
      }
      return true;
    }

    step() {
      this.move();
      this.ticks++;
      if (this.ticks % TICKS_PER_EPOCH !== 0) return;
      this.pairNearby();
      mutateBytes(this.bytes, this.mutationRate, this.mutationRandom);
      this.epochs++;
      if (this.activePatterns) {
        this.markCarriers();
        if (!this.carrierCount) this.activePatterns = null;
      }
    }

    snapshot() {
      const trail = new Uint8ClampedArray(this.field.length);
      for (let i = 0; i < trail.length; i++) {
        trail[i] = 255 * Math.max(0, (this.field[i] - 1.3) / 13) ** 1.18;
      }
      const points = new Float32Array(2 * POPULATION);
      for (let i = 0; i < POPULATION; i++) {
        points[2 * i] = this.x[i];
        points[2 * i + 1] = this.y[i];
      }
      return {
        width: WIDTH, height: HEIGHT, points, trail,
        carriers: this.carriers.slice(), carrierCount: this.carrierCount,
        epochs: this.epochs, encounters: this.encounters, discovery: this.discovery,
      };
    }
  }

  globalThis.ParticleLife = { ParticleSoup, testReplication, KNOWN_REPLICATOR, POPULATION };
})();
