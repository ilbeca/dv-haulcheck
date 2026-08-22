# Haulcheck

Traction calculator for Derail Valley. Static site, no build step, no
dependencies, deployed to GitHub Pages. The calculation runs in the visitor's
browser; Actions tests, gates the deploy, and watches for data drift.

## Architecture rules

No framework, no bundler, no npm install at runtime. Staying a plain static
site is the feature, not a limitation — it is what lets this survive game
updates without maintenance.

`js/physics.js` is a dependency-free ES module with no DOM references. Keep it
importable in isolation; that is the part other people may reuse. All UI logic
lives in `js/app.js`. Never import DOM code into physics.

## Invariant

`test/physics.test.mjs` contains a closure test: feed each locomotive's rated
load back in at the reference grade and speed, and the engine margin must land
on exactly 1.0. If it fails, calibration and assessment have drifted apart and
every output is suspect. Never weaken or skip it.

Anything that changes a number needs a test.

## Data

`data/*.json` is derived from the community wiki and is CC BY-SA 4.0, not MIT.
Provenance and confidence levels are in `DATA-SOURCES.md`. Estimated fields
carry a `*Confidence` key. Estimates are welcome; estimates presented as
measurements are not.

Tractive effort is never invented. Each locomotive is back-calculated from a
load it is measured to actually haul. If you are tempted to hardcode a
plausible-looking kN figure, stop.

The dataset is tied to a game build (`gameBuild` in `locomotives.json`). A
scheduled workflow opens an issue when Derail Valley ships a newer build. Never
bump `gameBuild` without re-checking the figures it claims to describe — the
field is a statement about what was verified, not a version label.

## Style

Comments explain why, not what. Conventional Commits.
