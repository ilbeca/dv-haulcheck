# Haulcheck

Traction calculator for Derail Valley consists. Static site, no build step, no
dependencies, deployed to GitHub Pages.

## What this answers

"Can this train climb that grade?" is three separate questions that fail
differently and need different fixes:

1. Does the engine make enough force?
2. Do the wheels have enough grip to put it down?
3. Can the locomotive shed the heat for as long as the climb lasts?

The tool names which one binds. Adding throttle to an adhesion-limited train
spins the wheels; sanding an overheating one does nothing.

## The one design rule that matters

The model has two halves and they must stay separate:

- **Resistance** is computed from first principles (gravity on grade, Davis
  rolling resistance, Röckl curve resistance). Ordinary railway engineering.
- **Tractive effort is never invented.** Nobody outside Altfuture knows the real
  curves. Each locomotive is back-calculated from a load it is *measured* to
  actually haul, on a reference climb of known grade, at a recorded speed.

If you are ever tempted to hardcode a plausible-looking kN figure for a
locomotive, stop. Fabricated numbers produce a confident tool that lies, which
is worse than no tool.

## Invariant

`test/physics.test.mjs` contains a closure test: feed each locomotive's rated
load back in at the reference grade and speed, and the engine margin must land
on exactly 1.0. If that test fails, calibration and assessment have drifted
apart and every output is suspect. Never weaken or skip it.

Run tests with `node --test test/physics.test.mjs`. Anything that changes a
number needs a test.

## Data rules

`data/*.json` is derived from the community wiki and is CC BY-SA 4.0, not MIT.
Provenance and confidence levels live in `DATA-SOURCES.md`.

Estimated fields carry a `*Confidence` key set to `"low"` or `"medium"`.
Estimates are welcome; estimates presented as measurements are not. If you add a
field you are unsure of, mark it.

Do not change a measured value without a stated source and a matching update to
`DATA-SOURCES.md`.

## Code

`js/physics.js` is a dependency-free ES module with no DOM references. Keep it
importable in isolation — that is the part other people may reuse. UI logic
lives in `js/app.js`.

No framework, no bundler, no npm install. Staying a static site is what makes
this survive game updates without maintenance.

## Style

Comments explain *why*, not *what*. British-leaning prose in docs. Conventional
Commits for messages.
