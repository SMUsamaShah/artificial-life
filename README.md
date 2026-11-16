# artificial-life

**[Run in browser](https://raw.githack.com/SMUsamaShah/artificial-life/claude/browser-javascript-implementation-gVRBA/index.html)**

A simple (300 lines of code) reproduction of [Computational Life: How Well-formed, Self-replicating Programs Emerge from Simple Interaction](https://arxiv.org/abs/2406.19108).

## Particle origins

**[Watch the first division](https://raw.githack.com/SMUsamaShah/artificial-life/particle-origins/particles/index.html?replay=first)** or open `particles/index.html` from a checkout.

The particle experiment uses the [Primordial Particle System](https://doi.org/10.1038/srep37969) of Schmickl, Stefanec and Crailsheim. The world starts by drawing 3,600 positions and headings independently. Each particle turns by 180° plus 17° times its neighbor count, with the sign set by the left/right imbalance, then advances 0.67 units. Its sensing radius is 5 units. The engine uses a continuous 250 × 180 torus with a fixed particle population.

In **seed 69**, a 13-particle group is first tracked at step 8. It grows, elongates, and divides at step 1,048. One daughter moves away, picks up loose particles, and divides at step 2,060. Both divisions pass the observer's persistence and spatial-separation checks.

The observer runs separately from the motion law. It follows groups using shared particle IDs and confirms a division after both daughters persist for at least 72 steps and their tracked cores are observed beyond sensing range at consecutive samples spanning at least 16 steps. Replay buttons fast-forward from the same random start and use color to trace the groups. Other seeds can be run from the field view.

The world controls offer **Classic**, **Two speeds**, and **Chase & evade**. Two speeds mixes particles that travel 0.60 and 0.77 units per step. In Chase & evade, one type steers toward nearby particles of the other type, and the other steers away. **Scatter**, **Bands**, and **Two clouds** sample different initial spatial distributions. The observer found stable divisions with both two-type rules on random-scatter runs. For repeatable examples, try Two speeds with seed 69 and Chase & evade with seed 17. The lineage replays use Classic and Scatter.

Choose **Uncapped** to keep the simulation running independently of the display. The worker queues computation back-to-back and handles pause and snapshot requests between batches. Steps per second are measured from the rendered snapshots. A replay pauses at the end of its clip, and Play continues from there.

Run the deterministic check with `node --test tests/particle-origins.test.cjs`.

## Program description

A 240x135 grid of 64 instruction-length [Brainfuck](https://en.wikipedia.org/wiki/Brainfuck)-like programs are randomly initialized. Every iteration, neighboring programs are randomly paired, have their instruction tapes concattenated together, and are run for a maximum of $`2^{13}`$ steps. Once execution completes, the tapes are split back apart. The instructions are such that they can loop and mutate the instruction tapes (programs) themselves. As found in the paper, self-replicating programs that copy themselves over their neighbor's tape often spontaneously emerge, which soon spread to take over the entire grid.

## Example simulation
Every pixel is an instruction; each instruction has a unique color, while black represents a value on the tape that is raw data storage / not an instruction. Every 8x8 section of pixels represents a single program.

```
uv run main.py --seed 1
```

In this run, a self-replicator emerges relatively early on into the run and soon takes over most of the grid, until a more efficient self-replicator evolves and takes over everything.

![Example](./universe.gif)
