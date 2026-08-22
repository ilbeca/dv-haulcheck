# Haulcheck

**Will this train climb that grade?** A traction calculator for [Derail Valley](https://www.derailvalley.com/) consists.

**→ [Open Haulcheck](https://ilbeca.github.io/dv-haulcheck/)**

[![test](https://github.com/ilbeca/dv-haulcheck/actions/workflows/test.yml/badge.svg)](https://github.com/ilbeca/dv-haulcheck/actions/workflows/test.yml)
[![deploy](https://github.com/ilbeca/dv-haulcheck/actions/workflows/pages.yml/badge.svg)](https://github.com/ilbeca/dv-haulcheck/actions/workflows/pages.yml)
[![build-watch](https://github.com/ilbeca/dv-haulcheck/actions/workflows/build-watch.yml/badge.svg)](https://github.com/ilbeca/dv-haulcheck/actions/workflows/build-watch.yml)

No install, no mod, nothing to keep in sync with the game. Open the page, pick your locomotives, type the tonnage off the job booklet, set the grade, get an answer — and, more usefully, get told *which* of the three things is about to stop you.

> Unofficial fan work. Derail Valley is owned by Altfuture. Not affiliated with or endorsed by them.

There is no backend. The arithmetic runs in your browser, GitHub Pages serves
the files, and Actions does the rest: it runs the tests, refuses to publish a
commit that fails them, and once a week checks whether Derail Valley has
shipped a build newer than the one the data claims to describe.

---

## Why this exists

Every Derail Valley player learns tonnage the same way: by stalling halfway up a hill and reversing back down. The in-game load ratings are a single number measured on flat ground, which tells you nothing about the grade you are actually looking at.

The deeper problem is that "can I pull this?" is really three separate questions, and the game gives you no instrument for any of them:

1. **Does the engine make enough force?**
2. **Do the wheels have enough grip to put that force down?**
3. **Can the locomotive shed the heat for as long as the climb lasts?**

They fail differently and they need different fixes. Adding throttle to an adhesion-limited train just spins the wheels. Adding sand to an overheating train does nothing at all. Haulcheck answers all three and names the one that binds.

## What it does

- **Climb check** — force needed against force available, with the limiting factor named
- **Heat check** — for passively-cooled locomotives, whether you can hold the grade long enough, and the speed at which the problem disappears
- **Adhesion check** — dry or wet rail, sanding on or off
- **Maximum tonnage** — the most you could couple up behind this set on this grade
- **Stall distance** — if you cannot hold the grade, how far a run-up carries you before you stop
- **Descent power** — the kilowatts you must dissipate to hold speed downhill, which is what actually cooks brake shoes
- **Length check** — whether the train will fit on the destination track, since freight hauls need the whole consist inside it
- **Multiple-unit support** — including refusing to add up locomotives the game will not let you MU together
- **Locomotive recommendation** — cheapest licence that clears the job, because every licence permanently raises copay and shortens the time bonus
- **Profile input** — paste a grade profile from the [community map](https://pyronicampt.github.io/DV-Community-Map/) and it picks out the ruling grade
- **Shareable links** — the whole setup lives in the URL hash

## How it works

The model has two halves, and the split matters.

### Resistance is computed from first principles

Ordinary railway engineering, nothing game-specific:

| Term | Formula | Notes |
|---|---|---|
| Grade | `1000 · g · p/100` N/t | Small-angle; under 0.1% error at 5% grade |
| Rolling | `a + b·v + c·v²` N/t | Davis, generic loaded-freight coefficients |
| Curve | Röckl | `6377/(R−55)` above 300 m, `4905/(R−30)` below |

### Tractive effort is measured, not invented

This is the important design decision. Nobody outside Altfuture knows the real tractive effort curves. Inventing plausible-looking numbers would produce a confident tool that lies, which is worse than no tool.

So instead, each locomotive is **back-calculated from a load it is measured to actually haul.** The community maintains an empirical load-rating table: each locomotive taken up a known reference climb until it can go no further, with the sustained speed recorded. From `ratedLoad`, `refGrade` and `refSpeed`, one effective sustained tractive effort falls out:

```
F_effective = (ratedLoad + locoMass) × [ grade resistance + rolling resistance at refSpeed ]
```

The honest limitation: this collapses a whole tractive effort curve into one number, valid near the reference speed. Good enough for "will this climb that", not a dynamometer.

### The model catches things the raw numbers do not

Two results fell out of the calibration rather than being coded in, which is the reason to trust it a little:

**The DM3 is adhesion-limited at its own rated load.** Back-calculating its 960 t rating implies a friction coefficient no rail surface can deliver. The community wiki independently notes the DM3 is "sand limited" and recommends derating 30–50% on sustained climbs. The model reaches that conclusion from physics alone, and derates it automatically.

**The classic beginner failure is thermal, not mechanical.** A forum post describes a DE2 failing to take 227 t out of the Harbour: *"it gets halfway up, through the second tunnel, but then it overheats and shuts off."* Haulcheck says that train has **41% tractive effort in hand** — the DE2 was never short of pull. It was short of cooling, because its traction motors are cooled only by the air going past them, so slowing down on a grade starts a spiral that ends in a shutdown. The tool flags it and tells you the speed that fixes it.

Both cases are in the test suite as regression tests.

## Running it

Pure static files, no build step, no dependencies.

```bash
git clone https://github.com/ilbeca/dv-haulcheck.git
cd dv-haulcheck
python3 -m http.server 8000    # any static server; fetch() will not work on file://
```

Then open `http://localhost:8000`.

Tests need Node 18 or newer and use the built-in runner:

```bash
node --test test/physics.test.mjs
```

`js/physics.js` is a dependency-free ES module with no DOM references. Import it anywhere.

## Tuning the model

Every coefficient lives in `DEFAULT_CONFIG` in `js/physics.js` and can be overridden per call:

```js
import { resolveConfig, assessClimb } from './js/physics.js';

const cfg = resolveConfig({
  refGrade_pct: 2.2,                 // if you re-measure the reference climb
  davis: { a: 22 },                  // stiffer rolling resistance
  adhesion: { dry: 0.28 }            // more pessimistic rail
});
```

If you measure something in game that contradicts the tool, that is a bug worth filing — with the numbers.

## Data and licensing

Code is MIT. Locomotive and car figures are derived from the community wiki and are therefore **CC BY-SA 4.0**; see [DATA-SOURCES.md](DATA-SOURCES.md) for per-field provenance and confidence levels. No game assets are redistributed.

Fields carrying a `Confidence` marker are estimates rather than measured values, and are labelled as such rather than quietly presented as fact. The S282's adhesive mass is the weakest number in the set: only its four coupled driving axles carry adhesive weight and the split is not documented anywhere.

## Roadmap

- [ ] Grade profiles for the common routes, so you pick a journey instead of typing a number
- [ ] Fuel, water and coal range estimates — for steam, range ends more hauls than tractive effort does
- [ ] DE6 Slug
- [ ] Modded locomotives via a drop-in JSON file

## Contributing

Measurements are worth more than code here. If you run a controlled test in game — known load, known grade, sustained speed, weather and sanding stated — open an issue. That is the input this project is actually short of.

## Credits

- The [Derail Valley Wiki](https://derailvalley.wiki.gg/) community, for the empirical load-rating tests that make the calibration possible
- The [official manual](https://manual.derailvalley.com/), for track roles and order mechanics
- [DV Community Map](https://pyronicampt.github.io/DV-Community-Map/) by PyroNicampt, for grade and curve data — the tool this one is meant to sit next to
