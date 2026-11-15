(() => {
  'use strict';

  const inWorker = typeof importScripts === 'function';
  if (inWorker) importScripts('../bff.js', './soup.js');

  function createRunner(batchBudgetMs) {
    let soup;
    let run;
    return data => {
      const { type, version } = data;
      if (type === 'reset') {
        run = version;
        soup = new ParticleLife.ParticleSoup(data.options);
      } else if (type === 'advance' && soup && version === run) {
        const deadline = performance.now() + batchBudgetMs;
        for (let i = 0; i < data.steps; i++) {
          soup.step();
          if (performance.now() >= deadline) break;
        }
      } else {
        return null;
      }
      return { version, state: soup.snapshot() };
    };
  }

  if (inWorker) {
    const run = createRunner(22);
    self.onmessage = ({ data }) => {
      const response = run(data);
      if (!response) return;
      const { points, trail, carriers } = response.state;
      self.postMessage(response, [points.buffer, trail.buffer, carriers.buffer]);
    };
  } else {
    // Also support opening the repository's HTML directly from disk.
    globalThis.createParticleRunner = createRunner;
  }
})();
