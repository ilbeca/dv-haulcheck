# Data sources, provenance and confidence

Everything in `data/` is derived from community documentation. No files, assets
or extracted values from the game itself are redistributed here.

## Licence

`data/locomotives.json` and `data/cars.json` are derived from the
[Derail Valley Wiki](https://derailvalley.wiki.gg/), whose content is licensed
**CC BY-SA 4.0**. That licence carries through: if you reuse these files, keep
the attribution and share alike. The code in this repository is MIT and the two
licences apply to their own directories.

Derail Valley is owned by Altfuture. This project is unofficial and unaffiliated.

## Field provenance

| Field | Source | Confidence |
|---|---|---|
| `massEmpty_t`, `massFull_t` | Wiki infobox, per-locomotive page | High — stated figures |
| `length_m` | Wiki infobox | High, except BE2 (see below) |
| `poweredAxles` | Locomotive naming convention (DM3 = diesel-mechanical, 3 axles) | High |
| `ratedLoad_t` | Wiki *Locomotive load rating chart*, community-measured | High — measured, not from the in-game catalog |
| `refSpeed_kmh` | Same chart, speed recorded at test point L3 | High |
| `adhesiveMass_t` | Derived | Varies — see below |
| `mu`, `remote`, `slugCompatible` | Wiki locomotive category page | High |
| `cooling`, `dynamicBrake` | Wiki per-locomotive Operation sections | High |
| `licenseCost` | Wiki infobox | Medium — subject to balance changes |
| Car `tare_t`, `length_m` | Wiki per-car pages | Medium — see conflicts below |
| Car `typicalLoad_t` | Working estimate | **Low — not a game constant** |

## Why the load ratings here are not the in-game ones

Since Build 98 the game ships a Vehicle Catalog with official load ratings. This
project deliberately uses the community-measured chart instead. The wiki itself
notes the fan-accumulated figures have improved accuracy over the official ones,
and unlike the official numbers they come with a stated test method: a known
climb, a stated start condition, and a recorded sustained speed at two fixed
points. The calibration in `physics.js` needs that method to work at all.

## Known conflicts and judgement calls

**BE2 load rating.** The wiki infobox states 800 t. Every other source
contradicts it: the measured chart says 100 t, and the article's own text says
300–400 t is the practical cap and that the BE2 "can only boost the load rating
of a train by about 50 tons". The infobox figure is almost certainly a typo for
80. This dataset uses the measured 100 t.

**BE2 length.** Not stated anywhere found. Estimated at 5.2 m from its role and
proportions, and flagged `lengthConfidence: "low"`.

**Tank car tare.** wiki.gg says 19,000 kg; the Fandom wiki says 23,000 kg. This
dataset splits at 21 t and marks the car table medium-confidence. The job
booklet always states the true total train mass, so prefer typing that in.

**S282 adhesive mass.** The single weakest number in the set, flagged
`adhesiveMassConfidence: "low"`. On a 2-8-2 only the four coupled driving axles
carry adhesive weight; the leading truck, trailing truck and the entire 89 t
tender carry none. The 76 t figure is an engineering estimate from the wheel
arrangement, not a measurement. It matters, because it is what decides whether
the S282 is power-limited or grip-limited near its rating.

**Gondola and autorack.** Tare and length are estimates; neither wiki page
states them.

## What is not modelled

Stated plainly, because the gaps are as important as the contents:

- **Fuel, water, coal and sand range.** On steam locomotives this ends more
  hauls than tractive effort does.
- **Tractive effort curves.** One effective figure per locomotive, valid near
  its reference speed. Starting effort at a dead stop is higher; effort at
  70 km/h is much lower.
- **Transmission behaviour.** DM3 gear selection and DH4 torque-converter
  shift points change real-world performance considerably.
- **Actual thermal simulation.** The heat index is a documented heuristic
  calibrated against known DE2 behaviour, not a model of the cooling system.
- **Brake shoe temperature.** Descent power is reported in kilowatts; what that
  does to your brakes is left to you.
- **Track geometry.** Curve radius is a single worst-case input, not a profile.

## Reproducing the calibration

```bash
node --test test/physics.test.mjs
```

The test `calibration reproduces each locomotive rated load on the reference
grade` is the closure check: feed each locomotive's rated load back into the
assessment at the reference grade and speed, and the engine margin must land on
exactly 1.0. If that test fails, calibration and assessment have drifted apart
and every number the tool prints is suspect.
