# artificial-life

**[Run in browser](https://raw.githack.com/SMUsamaShah/artificial-life/claude/browser-javascript-implementation-gVRBA/index.html)**

A simple (300 lines of code) reproduction of [Computational Life: How Well-formed, Self-replicating Programs Emerge from Simple Interaction](https://arxiv.org/abs/2406.19108).

## Particle soup

Open [physarum/index.html](./physarum/index.html) from a checkout, or select **Particle soup** in the grid app. To run it in a worker, serve the repository root with `python3 -m http.server 4175` and visit [localhost:4175/physarum/](http://localhost:4175/physarum/).

Each of 4,000 freely moving particles carries a 64-byte BFF tape. The particles deposit a chemical that diffuses and fades, and three forward-facing sensors steer them toward stronger trails. A spatial lookup supplies pairs for the shared BFF interpreter. A successful copy rewrites another particle's tape.

- **Follow trails** creates the vein network. **Free drift** uses the same random starting tapes for a given seed and drops chemical sensing. **Heritable attraction** uses the final tape byte to scale how strongly a particle turns toward a trail.
- **Random tapes** is the default. For a quick positive control, use **Known replicator**, seed **1**, and turn **Mutation** off. Gold marks particles matching the tracked byte patterns.
- The detector screens large cross-tape writes with six independent five-generation trials, following the approach in [BFF: Simple explanations for complex phenomena](https://arxiv.org/abs/2607.01483). It reports the first verified candidate and how many particle encounters had happened by then.

Run the regression checks with `node --test tests/particle-soup.test.cjs`.

## Program description

A 240x135 grid of 64 instruction-length [Brainfuck](https://en.wikipedia.org/wiki/Brainfuck)-like programs are randomly initialized. Every iteration, neighboring programs are randomly paired, have their instruction tapes concattenated together, and are run for a maximum of $`2^{13}`$ steps. Once execution completes, the tapes are split back apart. The instructions are such that they can loop and mutate the instruction tapes (programs) themselves. As found in the paper, self-replicating programs that copy themselves over their neighbor's tape often spontaneously emerge, which soon spread to take over the entire grid.

## Example simulation
Every pixel is an instruction; each instruction has a unique color, while black represents a value on the tape that is raw data storage / not an instruction. Every 8x8 section of pixels represents a single program.

```
uv run main.py --seed 1
```

In this run, a self-replicator emerges relatively early on into the run and soon takes over most of the grid, until a more efficient self-replicator evolves and takes over everything.

![Example](./universe.gif)
