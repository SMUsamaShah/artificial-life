(() => {
  'use strict';

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
    const middle = len >> 1;
    let pc = 0, head0 = 0, head1 = 0;
    let crossWrites = 0;
    for (let iter = 0; iter < MAX_ITER; iter++) {
      if (pc < 0 || pc >= len) break;
      const op = tape[pc];
      if      (op === LT)    head0 = head0 === 0 ? len - 1 : head0 - 1;
      else if (op === GT)    head0 = head0 + 1 === len ? 0 : head0 + 1;
      else if (op === LB)    head1 = head1 === 0 ? len - 1 : head1 - 1;
      else if (op === RB)    head1 = head1 + 1 === len ? 0 : head1 + 1;
      else if (op === MINUS) tape[head0] = (tape[head0] - 1) & 0xFF;
      else if (op === PLUS)  tape[head0] = (tape[head0] + 1) & 0xFF;
      else if (op === DOT || op === COMMA) {
        const from = op === DOT ? head0 : head1;
        const to = op === DOT ? head1 : head0;
        if ((from < middle) !== (to < middle) && tape[from] !== tape[to]) crossWrites++;
        tape[to] = tape[from];
      }
      else if (op === LBRACK && tape[head0] === 0) {
        pc = seekMatch(tape, pc, 1, LBRACK, RBRACK);
        if (pc < 0) break;
      } else if (op === RBRACK && tape[head0] !== 0) {
        pc = seekMatch(tape, pc, -1, RBRACK, LBRACK);
        if (pc < 0) break;
      }
      pc++;
    }
    return crossWrites;
  }

  function mutateBytes(tape, rate, random) {
    if (!(rate > 0)) return;
    const expected = tape.length * rate;
    let mutations;
    if (expected < 30) {
      const limit = Math.exp(-expected);
      let sample = 1;
      let draws = 0;
      do { sample *= random(); draws++; } while (sample > limit);
      mutations = draws - 1;
    } else {
      mutations = Math.max(0, Math.round(expected + Math.sqrt(expected) * (random() * 2 - 1) * 1.7));
    }
    for (let i = 0; i < mutations; i++) {
      tape[(random() * tape.length) | 0] = (random() * 256) | 0;
    }
  }

  globalThis.BFF = { TAPE_SIZE, runTape, mutateBytes };
})();
