(() => {
  'use strict';

  const WIDTH = 250;
  const HEIGHT = 180;
  const RADIUS = 5;
  const SPEED = 0.67;
  const COUNT = WIDTH * HEIGHT * 0.08;
  const COLS = WIDTH / RADIUS;
  const ROWS = HEIGHT / RADIUS;
  const offsets = new Int16Array(COLS * ROWS * 9);
  const turnX = new Float64Array(COUNT * 2 + 1);
  const turnY = new Float64Array(turnX.length);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let offset = (row * COLS + col) * 9;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          offsets[offset++] = wrap(row + dy, ROWS) * COLS + wrap(col + dx, COLS);
        }
      }
    }
  }
  for (let n = -COUNT; n <= COUNT; n++) {
    const angle = Math.PI + n * (17 * Math.PI / 180);
    turnX[n + COUNT] = Math.cos(angle);
    turnY[n + COUNT] = Math.sin(angle);
  }

  function wrap(value, extent) {
    if (value >= extent) return value - extent;
    if (value < 0) return value + extent;
    return value;
  }

  function shortest(value, extent) {
    if (value > extent / 2) return value - extent;
    if (value < -extent / 2) return value + extent;
    return value;
  }

  function bin(x, y) {
    return ((y / RADIUS) | 0) * COLS + ((x / RADIUS) | 0);
  }

  function randomStream(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class World {
    constructor(seed) {
      this.tick = 0;
      this.random = randomStream(seed);
      this.x = new Float64Array(COUNT);
      this.y = new Float64Array(COUNT);
      this.vx = new Float64Array(COUNT);
      this.vy = new Float64Array(COUNT);
      this.density = new Uint16Array(COUNT);
      this.head = new Int16Array(COLS * ROWS).fill(-1);
      this.next = new Int16Array(COUNT).fill(-1);
      this.prev = new Int16Array(COUNT).fill(-1);
      this.order = new Uint16Array(COUNT);
      for (let id = 0; id < COUNT; id++) {
        const x = this.random() * WIDTH;
        const y = this.random() * HEIGHT;
        const angle = this.random() * 2 * Math.PI;
        this.x[id] = x;
        this.y[id] = y;
        this.vx[id] = Math.cos(angle);
        this.vy[id] = Math.sin(angle);
        this.order[id] = id;
        this.insert(id, bin(x, y));
      }
    }

    insert(id, cell) {
      const first = this.head[cell];
      this.prev[id] = -1;
      this.next[id] = first;
      if (first >= 0) this.prev[first] = id;
      this.head[cell] = id;
    }

    remove(id, cell) {
      const previous = this.prev[id];
      const next = this.next[id];
      if (previous < 0) this.head[cell] = next;
      else this.next[previous] = next;
      if (next >= 0) this.prev[next] = previous;
    }

    visitNeighbors(id, radius, visit) {
      const x = this.x[id];
      const y = this.y[id];
      const start = 9 * bin(x, y);
      const radiusSquared = radius * radius;
      for (let k = start; k < start + 9; k++) {
        for (let other = this.head[offsets[k]]; other >= 0; other = this.next[other]) {
          if (other === id) continue;
          const dx = shortest(this.x[other] - x, WIDTH);
          const dy = shortest(this.y[other] - y, HEIGHT);
          if (dx * dx + dy * dy <= radiusSquared) visit(other);
        }
      }
    }

    step() {
      const { x, y, vx, vy, order, head, next, random } = this;
      for (let i = order.length - 1; i > 0; i--) {
        const j = (random() * (i + 1)) | 0;
        const id = order[i];
        order[i] = order[j];
        order[j] = id;
      }
      for (let i = 0; i < order.length; i++) {
        const id = order[i];
        const originX = x[id];
        const originY = y[id];
        const headingX = vx[id];
        const headingY = vy[id];
        const cell = bin(originX, originY);
        const start = cell * 9;
        let left = 0;
        let right = 0;
        for (let k = start; k < start + 9; k++) {
          for (let other = head[offsets[k]]; other >= 0; other = next[other]) {
            if (other === id) continue;
            const dx = shortest(x[other] - originX, WIDTH);
            const dy = shortest(y[other] - originY, HEIGHT);
            if (dx * dx + dy * dy > RADIUS * RADIUS) continue;
            if (headingX * dy - headingY * dx > 0) right++;
            else left++;
          }
        }
        const count = left + right;
        this.density[id] = count;
        // A fixed turn plus 17 degrees per neighbor, toward the busier side.
        const turn = COUNT + count * Math.sign(right - left);
        const dx = headingX * turnX[turn] - headingY * turnY[turn];
        const dy = headingX * turnY[turn] + headingY * turnX[turn];
        vx[id] = dx;
        vy[id] = dy;
        x[id] = wrap(originX + SPEED * dx, WIDTH);
        y[id] = wrap(originY + SPEED * dy, HEIGHT);
        const destination = bin(x[id], y[id]);
        if (destination !== cell) {
          this.remove(id, cell);
          this.insert(id, destination);
        }
      }
      this.tick++;
    }
  }

  globalThis.ParticleWorld = { World, WIDTH, HEIGHT, COUNT, RADIUS, wrap, shortest };
})();
