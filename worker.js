'use strict';

importScripts('./bff.js');
const { TAPE_SIZE, runTape } = BFF;

// ── Control buffer indices ────────────────────────────────────────────────────
const GEN        = 0;  // generation counter: main increments to signal new work
const PAIR_COUNT = 1;  // number of pairs this epoch
const DONE       = 2;  // workers increment when finished; main waits for numWorkers

// ── Main ──────────────────────────────────────────────────────────────────────
let programs, pairsBuf, ctrl32;
let workerId, numWorkers;

self.onmessage = function (e) {
  const d = e.data;
  programs   = new Uint8Array(d.programsSAB);
  pairsBuf   = new Uint16Array(d.pairsSAB);
  ctrl32     = new Int32Array(d.ctrlSAB);
  workerId   = d.workerId;
  numWorkers = d.numWorkers;

  // Each worker owns a private concat scratch buffer — no allocation per pair.
  const concat = new Uint8Array(TAPE_SIZE * 2);

  let myGen = 0;

  // Work loop: block until main signals a new generation, execute assigned pairs.
  while (true) {
    // Returns immediately if ctrl32[GEN] !== myGen (value already changed).
    Atomics.wait(ctrl32, GEN, myGen);
    myGen = Atomics.load(ctrl32, GEN);
    if (myGen < 0) break;  // stop signal from main thread

    const pairCount = Atomics.load(ctrl32, PAIR_COUNT);

    // Distribute pairs evenly across workers.
    const chunk = Math.ceil(pairCount / numWorkers);
    const start = workerId * chunk;
    const end   = Math.min(start + chunk, pairCount);

    for (let pi = start; pi < end; pi++) {
      const idxA  = pairsBuf[pi * 2];
      const idxB  = pairsBuf[pi * 2 + 1];
      const baseA = idxA * TAPE_SIZE;
      const baseB = idxB * TAPE_SIZE;

      concat.set(programs.subarray(baseA, baseA + TAPE_SIZE), 0);
      concat.set(programs.subarray(baseB, baseB + TAPE_SIZE), TAPE_SIZE);
      runTape(concat);
      programs.set(concat.subarray(0, TAPE_SIZE), baseA);
      programs.set(concat.subarray(TAPE_SIZE),    baseB);
    }

    // Signal done; last worker notifies main.
    if (Atomics.add(ctrl32, DONE, 1) + 1 === numWorkers) {
      Atomics.notify(ctrl32, DONE);
    }
  }
};
