(() => {
  'use strict';

  // Steps and track IDs from an observed run. The runner starts at step zero
  // and advances the same physics to replay them.
  const SEED = 69;
  const founder = { id: 4, color: 1 };
  const daughter = { id: 65, color: 2 };
  const grandchild = { id: 309, color: 3 };
  const STAGES = {
    origin: {
      start: 0, end: 400, width: 47, x: 16.397, y: 39.668,
      watch: { split: Infinity, groups: [founder] },
      before: 'Loose particles assemble into a rotating ring',
    },
    first: {
      start: 932, end: 1160, width: 72, x: 19.195, y: 39.702,
      watch: { split: 1048, groups: [founder, daughter] },
      before: 'The growing ring elongates before its first division',
      after: 'The two daughter groups are moving apart',
    },
    daughter: {
      start: 1932, end: 2180, width: 68, x: 14.469, y: 18.342,
      watch: { split: 2060, groups: [daughter, grandchild] },
      before: 'The bronze daughter has gathered loose particles and is dividing',
      after: 'A new ring separates from the bronze daughter',
    },
  };

  globalThis.ParticleReplay = { SEED, STAGES };
})();
