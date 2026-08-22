import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  G,
  DEFAULT_CONFIG,
  resolveConfig,
  rollingResistance_N_per_t,
  curveResistance_N_per_t,
  gradeResistance_N_per_t,
  effectiveTractiveEffort_N,
  adhesionLimit_N,
  summariseLocos,
  assessClimb,
  maxTrailingMass_t,
  descentPower,
  rulingGrade,
  steepestDescent,
  parseProfile,
  summariseCars,
  recommendPower
} from '../js/physics.js';

const here = dirname(fileURLToPath(import.meta.url));
const locos = JSON.parse(readFileSync(join(here, '../data/locomotives.json'), 'utf8')).locomotives;
const cars = JSON.parse(readFileSync(join(here, '../data/cars.json'), 'utf8')).cars;
const byId = id => locos.find(l => l.id === id);

/* --- resistance ---------------------------------------------------- */

test('grade resistance matches m*g*sin(theta) to small-angle accuracy', () => {
  // 1% grade on 1000 t should be about 98.1 kN
  assert.ok(Math.abs(gradeResistance_N_per_t(1) - 98.1) < 0.01);
  assert.equal(gradeResistance_N_per_t(0), 0);
  // and it is linear
  assert.ok(Math.abs(gradeResistance_N_per_t(2) - 2 * gradeResistance_N_per_t(1)) < 1e-9);
});

test('rolling resistance rises with speed and never goes negative', () => {
  const at0 = rollingResistance_N_per_t(0);
  const at40 = rollingResistance_N_per_t(40);
  const at80 = rollingResistance_N_per_t(80);
  assert.equal(at0, DEFAULT_CONFIG.davis.a);
  assert.ok(at40 > at0);
  assert.ok(at80 > at40);
  // the quadratic term should dominate the growth by 80 km/h
  assert.ok(at80 - at40 > at40 - at0);
});

test('curve resistance is zero on tangent track and grows as curves tighten', () => {
  assert.equal(curveResistance_N_per_t(null), 0);
  assert.equal(curveResistance_N_per_t(0), 0);
  assert.ok(curveResistance_N_per_t(200) > curveResistance_N_per_t(500));
  assert.ok(Number.isFinite(curveResistance_N_per_t(35)));
});

/* --- calibration --------------------------------------------------- */

test('every locomotive back-calculates to a physically sane tractive effort', () => {
  for (const loco of locos) {
    const te = effectiveTractiveEffort_N(loco);
    assert.ok(te > 0, `${loco.id} produced non-positive tractive effort`);
    // Nothing in this game is a 1 MN machine.
    assert.ok(te < 500_000, `${loco.id} tractive effort implausibly high: ${te}`);
  }
});

test('calibration reproduces each locomotive rated load on the reference grade', () => {
  // This is the closure test: feed the rated load back in and the margin must
  // land on 1.0. If this breaks, calibration and assessment have drifted apart.
  for (const loco of locos) {
    const summary = summariseLocos([{ loco, powered: true }], { sand: true });
    const result = assessClimb({
      locoSummary: summary,
      trailingMass_t: loco.ratedLoad_t,
      grade_pct: DEFAULT_CONFIG.refGrade_pct,
      speed_kmh: loco.refSpeed_kmh
    });
    const enginePart = result.engineTractiveEffort_N / result.required_N;
    assert.ok(
      Math.abs(enginePart - 1) < 1e-9,
      `${loco.id} does not close: engine margin ${enginePart}`
    );
  }
});

test('the DM3 rated load is adhesion-limited, matching community experience', () => {
  // The wiki notes the DM3 is "sand limited" and should be derated 30-50% on
  // sustained climbs. The model should reach that conclusion on its own.
  const dm3 = byId('DM3');
  const summary = summariseLocos([{ loco: dm3, powered: true }], { sand: true });
  assert.ok(
    summary.adhesionLimit_N < summary.tractiveEffort_N,
    'DM3 should be adhesion-limited, not power-limited'
  );

  const derated = maxTrailingMass_t({ locoSummary: summary, grade_pct: 2.0, speed_kmh: 5 });
  assert.ok(derated < dm3.ratedLoad_t, 'usable load should fall below the rated figure');
  assert.ok(derated > dm3.ratedLoad_t * 0.4, 'but not collapse to nothing');
});

test('the DE6 is power-limited rather than adhesion-limited in the dry', () => {
  const summary = summariseLocos([{ loco: byId('DE6'), powered: true }], { sand: false });
  assert.ok(summary.adhesionLimit_N > summary.tractiveEffort_N);
});

test('wet rail and sand move the adhesion limit in the right directions', () => {
  const de2 = byId('DE2');
  const dry = adhesionLimit_N(de2, {});
  const wet = adhesionLimit_N(de2, { wet: true });
  const wetSanded = adhesionLimit_N(de2, { wet: true, sand: true });
  assert.ok(wet < dry);
  assert.ok(wetSanded > wet);
  assert.ok(wetSanded < dry + 1e-6 + adhesionLimit_N(de2, { sand: true }) - dry + 1e-6);
});

/* --- consists ------------------------------------------------------ */

test('a dead locomotive adds mass and length but no tractive effort', () => {
  const de2 = byId('DE2');
  const alone = summariseLocos([{ loco: de2, powered: true }]);
  const withDead = summariseLocos([
    { loco: de2, powered: true },
    { loco: de2, powered: false }
  ]);
  assert.equal(withDead.tractiveEffort_N, alone.tractiveEffort_N);
  assert.ok(withDead.mass_t > alone.mass_t);
  assert.ok(withDead.length_m > alone.length_m);
});

test('MU applies an efficiency penalty and flags incompatible pairings', () => {
  const de2 = byId('DE2');
  const single = summariseLocos([{ loco: de2, powered: true }]);
  const pair = summariseLocos([
    { loco: de2, powered: true },
    { loco: de2, powered: true }
  ]);
  assert.ok(pair.tractiveEffort_N < 2 * single.tractiveEffort_N);
  assert.ok(pair.tractiveEffort_N > 1.8 * single.tractiveEffort_N);
  assert.equal(pair.muIncompatible, false);

  const illegal = summariseLocos([
    { loco: de2, powered: true },
    { loco: byId('S282'), powered: true }
  ]);
  assert.equal(illegal.muIncompatible, true);
  assert.deepEqual(illegal.nonMuPowered, ['S282']);
});

test('two DH4s out-pull one DE6, as the wiki claims', () => {
  const twoDh4 = summariseLocos([
    { loco: byId('DH4'), powered: true },
    { loco: byId('DH4'), powered: true }
  ]);
  const de6 = summariseLocos([{ loco: byId('DE6'), powered: true }]);
  assert.ok(
    maxTrailingMass_t({ locoSummary: twoDh4, grade_pct: 2.0, speed_kmh: 20 }) >
      maxTrailingMass_t({ locoSummary: de6, grade_pct: 2.0, speed_kmh: 20 })
  );
});

/* --- climbs -------------------------------------------------------- */

test('steeper grades reduce the load that can be taken', () => {
  const summary = summariseLocos([{ loco: byId('DE6'), powered: true }]);
  const flat = maxTrailingMass_t({ locoSummary: summary, grade_pct: 0.1 });
  const mild = maxTrailingMass_t({ locoSummary: summary, grade_pct: 1.0 });
  const steep = maxTrailingMass_t({ locoSummary: summary, grade_pct: 2.5 });
  assert.ok(flat > mild);
  assert.ok(mild > steep);
});

test('the classic beginner failure is diagnosed as heat, not lack of pull', () => {
  // A real forum case: a DE2 taking 227 t up the west Harbour climb "gets
  // halfway up, through the second tunnel, but then it overheats and shuts
  // off". The tractive effort was never the problem, and the model should say
  // so rather than blaming the wrong thing.
  const summary = summariseLocos([{ loco: byId('DE2'), powered: true }], { sand: true });
  const grinding = assessClimb({
    locoSummary: summary,
    trailingMass_t: 227,
    grade_pct: 2.2,
    speed_kmh: 20,
    entrySpeed_kmh: 40,
    climbLength_m: 1200
  });

  assert.ok(grinding.margin > 1, 'the DE2 has the tractive effort for this load');
  assert.equal(grinding.limitedBy, 'heat');
  assert.equal(grinding.heat.level, 'overheat');
  assert.equal(grinding.heat.cooling, 'passive');
  assert.ok(grinding.heat.climbMinutes > 0);

  // And the documented fix — carry speed into the grade — should register.
  const running = assessClimb({
    locoSummary: summary,
    trailingMass_t: 227,
    grade_pct: 2.2,
    speed_kmh: 40,
    climbLength_m: 1200
  });
  assert.notEqual(running.heat.level, 'overheat');
  assert.ok(grinding.heat.speedToClearHeat_kmh > 20);
});

test('a train short of pull is not blamed on cooling', () => {
  // The page opens on this case: a DE2 with 400 t on 2%. It needs 97 kN and
  // makes 90, so what stops it is force, full stop.
  //
  // Heat utilisation is required/engine, which exceeds 1 whenever the force is
  // short. Without a margin check every power stall reads as an overheat, and
  // the tool ends up advising a run-up to cool a train that cannot hold the
  // speed it is already at — the opposite of the advice that helps.
  const summary = summariseLocos([{ loco: byId('DE2'), powered: true }], { sand: true });
  const stalling = assessClimb({
    locoSummary: summary,
    trailingMass_t: 400,
    grade_pct: 2.0,
    speed_kmh: 25,
    entrySpeed_kmh: 40,
    climbLength_m: 800
  });

  assert.ok(stalling.margin < 1, 'this load is beyond the DE2 on this grade');
  assert.equal(stalling.verdict, 'stalls');
  assert.equal(stalling.limitedBy, 'power');
  assert.ok(stalling.heat.index > 1, 'the heat index is high here, but it is not the binding limit');
});

test('actively cooled locomotives are not penalised for climbing slowly', () => {
  const slowDe6 = assessClimb({
    locoSummary: summariseLocos([{ loco: byId('DE6'), powered: true }]),
    trailingMass_t: 700,
    grade_pct: 2.0,
    speed_kmh: 12
  });
  assert.equal(slowDe6.heat.cooling, 'active');
  assert.equal(slowDe6.heat.speedToClearHeat_kmh, null);
});

test('steam locomotives get no heat index because that is not their limit', () => {
  const s282 = assessClimb({
    locoSummary: summariseLocos([{ loco: byId('S282'), powered: true }], { sand: true }),
    trailingMass_t: 800,
    grade_pct: 2.0,
    speed_kmh: 25
  });
  assert.equal(s282.heat.cooling, 'steam');
  assert.equal(s282.heat.index, null);
  assert.equal(s282.heat.level, 'unknown');
});

test('a stalling train reports how far momentum carries it', () => {
  const summary = summariseLocos([{ loco: byId('DE2'), powered: true }]);
  const result = assessClimb({
    locoSummary: summary,
    trailingMass_t: 900,
    grade_pct: 2.5,
    speed_kmh: 15,
    entrySpeed_kmh: 45,
    climbLength_m: 800
  });
  assert.equal(result.verdict, 'stalls');
  assert.ok(result.stallDistance_m > 0);
  assert.ok(Number.isFinite(result.stallDistance_m));
  assert.equal(result.clearsClimbOnMomentum, result.stallDistance_m >= 800);
});

test('no entry speed means no momentum claim rather than a fabricated one', () => {
  const summary = summariseLocos([{ loco: byId('DE2'), powered: true }]);
  const result = assessClimb({
    locoSummary: summary,
    trailingMass_t: 900,
    grade_pct: 2.5
  });
  assert.equal(result.stallDistance_m, null);
  assert.equal(result.clearsClimbOnMomentum, null);
});

/* --- descents ------------------------------------------------------ */

test('descent power scales with mass, grade and speed', () => {
  const base = descentPower({ totalMass_t: 800, grade_pct: -2, speed_kmh: 40 });
  const heavier = descentPower({ totalMass_t: 1600, grade_pct: -2, speed_kmh: 40 });
  const steeper = descentPower({ totalMass_t: 800, grade_pct: -3, speed_kmh: 40 });
  const faster = descentPower({ totalMass_t: 800, grade_pct: -2, speed_kmh: 60 });

  assert.ok(base.power_kW > 0);
  assert.ok(heavier.power_kW > base.power_kW);
  assert.ok(steeper.power_kW > base.power_kW);
  assert.ok(faster.power_kW > base.power_kW);
  // per-100t normalisation should be mass-independent
  assert.ok(Math.abs(heavier.power_kW_per_100t - base.power_kW_per_100t) < 1e-6);
});

test('a gentle enough descent does not run away', () => {
  const gentle = descentPower({ totalMass_t: 500, grade_pct: -0.1, speed_kmh: 30 });
  assert.equal(gentle.runsAwayFreely, false);
  assert.equal(gentle.power_kW, 0);
});

/* --- profiles ------------------------------------------------------ */

test('ruling grade ignores short spikes but not sustained climbs', () => {
  const segments = [
    { grade_pct: 3.5, length_m: 40 },
    { grade_pct: 2.1, length_m: 900 },
    { grade_pct: -1.2, length_m: 500 }
  ];
  assert.equal(rulingGrade(segments).grade_pct, 2.1);
  assert.equal(steepestDescent(segments).grade_pct, -1.2);
});

test('ruling grade falls back to the spike when nothing is sustained', () => {
  const segments = [{ grade_pct: 1.8, length_m: 60 }];
  assert.equal(rulingGrade(segments).grade_pct, 1.8);
});

test('a profile with no climb has no ruling grade', () => {
  assert.equal(rulingGrade([{ grade_pct: -1, length_m: 900 }]), null);
  assert.equal(steepestDescent([{ grade_pct: 1, length_m: 900 }]), null);
});

test('profile parsing handles comments, blanks and malformed lines', () => {
  const { segments, errors } = parseProfile(
    '# out of the harbour\n+2.1 600\n-1.4, 900, 450\n\nnonsense here\n0 300\n'
  );
  assert.equal(segments.length, 3);
  assert.equal(segments[0].grade_pct, 2.1);
  assert.equal(segments[1].radius_m, 450);
  assert.equal(segments[0].radius_m, null);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 5);
});

test('empty profile input is not an error', () => {
  assert.deepEqual(parseProfile(''), { segments: [], errors: [] });
  assert.deepEqual(parseProfile(null), { segments: [], errors: [] });
});

/* --- cars ---------------------------------------------------------- */

test('loaded cars weigh more than empty ones and length is independent of load', () => {
  const hopper = cars.find(c => c.id === 'hopper');
  const empty = summariseCars([{ car: hopper, count: 10, loaded: false }]);
  const full = summariseCars([{ car: hopper, count: 10, loaded: true }]);
  assert.ok(full.mass_t > empty.mass_t);
  assert.equal(full.length_m, empty.length_m);
  assert.equal(full.count, 10);
});

/* --- recommendation ------------------------------------------------ */

test('recommendation prefers the cheapest licence that clears the job', () => {
  const options = recommendPower({
    locomotives: locos,
    trailingMass_t: 250,
    grade_pct: 2.0,
    speed_kmh: 20,
    conditions: { sand: true }
  });
  assert.ok(options.length > 0);
  for (let i = 1; i < options.length; i++) {
    assert.ok(options[i].licenseCost >= options[i - 1].licenseCost);
  }
});

test('recommendation never proposes a pairing that cannot be multiple-united', () => {
  const options = recommendPower({
    locomotives: locos,
    trailingMass_t: 1500,
    grade_pct: 2.0,
    conditions: { sand: true }
  });
  for (const opt of options) {
    if (!opt.label.includes('+')) continue;
    for (const id of opt.label.split(' + ')) {
      assert.equal(byId(id).mu, true, `${opt.label} pairs a non-MU locomotive`);
    }
  }
});

test('an impossible job returns no options rather than a bad one', () => {
  const options = recommendPower({
    locomotives: locos,
    trailingMass_t: 50000,
    grade_pct: 3.0
  });
  assert.equal(options.length, 0);
});

/* --- config -------------------------------------------------------- */

test('config overrides merge without losing untouched defaults', () => {
  const cfg = resolveConfig({ refGrade_pct: 1.5, davis: { a: 25 } });
  assert.equal(cfg.refGrade_pct, 1.5);
  assert.equal(cfg.davis.a, 25);
  assert.equal(cfg.davis.b, DEFAULT_CONFIG.davis.b);
  assert.equal(cfg.adhesion.dry, DEFAULT_CONFIG.adhesion.dry);
});

test('G is the value the rest of the model assumes', () => {
  assert.equal(G, 9.81);
});
