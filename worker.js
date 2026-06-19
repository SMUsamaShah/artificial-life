'use strict';

// ── Opcode constants (must match main thread) ─────────────────────────────────
const LT     = 60;
const GT     = 62;
const LB     = 123;
const RB     = 125;
const MINUS  = 45;
const PLUS   = 43;
const DOT    = 46;
const COMMA  = 44;
const LBRACK = 91;
const RBRACK = 93;

const TAPE_SIZE = 64;
const MAX_ITER  = 8192;

// ── Control buffer indices ────────────────────────────────────────────────────
const GEN        = 0;  // generation counter: main increments to signal new work
const PAIR_COUNT = 1;  // number of pairs this epoch
const DONE       = 2;  // workers increment when finished; main waits for numWorkers

// ── Interpreter ───────────────────────────────────────────────────────────────
function seekMatch(tape, pc, step, openTok, closeTok) {
  const len = tape.length;
  let depth = 1;
  pc += step;
  while (pc >= 0 && pc < len && depth > 0) {
    const op = tape[pc];
    if      (op === openTok)  depth++;
    else if (op === closeTok) depth--;
    pc += step;
  }
  return depth === 0 ? pc - step : -1;
}

function runTape(tape) {
  const len = tape.length;
  let pc = 0, head0 = 0, head1 = 0;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    if (pc < 0 || pc >= len) break;
    const op = tape[pc];
    if      (op === LT)    head0 = head0 === 0 ? len - 1 : head0 - 1;
    else if (op === GT)    head0 = head0 + 1 === len ? 0 : head0 + 1;
    else if (op === LB)    head1 = head1 === 0 ? len - 1 : head1 - 1;
    else if (op === RB)    head1 = head1 + 1 === len ? 0 : head1 + 1;
    else if (op === MINUS) tape[head0] = (tape[head0] - 1) & 0xFF;
    else if (op === PLUS)  tape[head0] = (tape[head0] + 1) & 0xFF;
    else if (op === DOT)   tape[head1] = tape[head0];
    else if (op === COMMA) tape[head0] = tape[head1];
    else if (op === LBRACK && tape[head0] === 0) {
      pc = seekMatch(tape, pc, 1, LBRACK, RBRACK);
      if (pc < 0) break;
    } else if (op === RBRACK && tape[head0] !== 0) {
      pc = seekMatch(tape, pc, -1, RBRACK, LBRACK);
      if (pc < 0) break;
    }
    pc++;
  }
}

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
