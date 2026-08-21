/**
 * dv-haulcheck — traction physics for Derail Valley consists.
 *
 * Everything here is SI internally: kilograms, newtons, metres, metres per
 * second. Conversions to tonnes and km/h happen at the boundary only.
 *
 * The model has two halves that are worth keeping separate in your head:
 *
 *   1. Resistance is computed from first principles. Gravity on a grade,
 *      Davis rolling resistance, Röckl curve resistance. These are ordinary
 *      railway engineering and they do not depend on anything Derail Valley
 *      specific.
 *
 *   2. Tractive effort is NOT invented. Nobody outside Altfuture knows the
 *      real tractive effort curves, so making numbers up would produce a
 *      confident-looking tool that lies. Instead each locomotive is
 *      back-calculated from a load it is measured to actually haul, on a
 *      reference climb of known grade, at a measured sustained speed. That
 *      gives a single effective sustained tractive effort per locomotive,
 *      anchored to observed in-game behaviour.
 *
 * The honest limitation of (2): it collapses a whole tractive effort curve
 * into one number valid near the reference speed. It is good for "will this
 * train climb this grade", and it is not a dynamometer.
 */

export const G = 9.81;

/** Defaults for every tunable in the model. Override any subset. */
export const DEFAULT_CONFIG = {
  /** Grade of the reference climb the rated loads were measured on, in percent. */
  refGrade_pct: 2.0,

  /**
   * Davis rolling resistance, in newtons per tonne, with v in km/h:
   *   r(v) = a + b*v + c*v^2
   * Generic loaded-freight coefficients. Not derived from Derail Valley.
   */
  davis: { a: 20.0, b: 0.09, c: 0.0045 },

  /** Wheel-rail friction coefficients. */
  adhesion: {
    dry: 0.30,
    wet: 0.20,
    sandBonus: 0.05
  },

  /**
   * Fraction of combined tractive effort actually delivered when locomotives
   * are multiple-united. Real MU sets never distribute power perfectly.
   * Heuristic, deliberately mild.
   */
  muEfficiency: 0.95,

  /** Margin below which a climb is called marginal rather than comfortable. */
  marginComfortable: 1.25,
  marginMarginal: 1.0
};

/** Deep-merges a partial config over the defaults. One level is enough here. */
export function resolveConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    davis: { ...DEFAULT_CONFIG.davis, ...(overrides.davis || {}) },
    adhesion: { ...DEFAULT_CONFIG.adhesion, ...(overrides.adhesion || {}) }
  };
}

/* ------------------------------------------------------------------ */
/* Resistance                                                          */
/* ------------------------------------------------------------------ */

/**
 * Specific rolling resistance in N per tonne at a given speed.
 * @param {number} speed_kmh
 * @param {object} [cfg]
 */
export function rollingResistance_N_per_t(speed_kmh, cfg = DEFAULT_CONFIG) {
  const { a, b, c } = cfg.davis;
  return a + b * speed_kmh + c * speed_kmh * speed_kmh;
}

/**
 * Specific curve resistance in N per tonne (Röckl). Pass null or 0 for
 * tangent track. Derail Valley curves are generous, so this is usually a
 * minor term, but the tightest yard curves are not.
 * @param {number|null} radius_m
 */
export function curveResistance_N_per_t(radius_m) {
  if (!radius_m || radius_m <= 0) return 0;
  if (radius_m > 300) return 6377 / (radius_m - 55);
  if (radius_m > 40) return 4905 / (radius_m - 30);
  return 4905 / 10; // absurdly tight; clamp rather than divide by ~zero
}

/**
 * Specific grade resistance in N per tonne. Positive grade opposes motion.
 * Small-angle approximation; the error is under 0.1% at 5% grade.
 * @param {number} grade_pct
 */
export function gradeResistance_N_per_t(grade_pct) {
  return 1000 * G * (grade_pct / 100);
}

/**
 * Total specific resistance in N per tonne.
 */
export function totalResistance_N_per_t(grade_pct, speed_kmh, radius_m, cfg = DEFAULT_CONFIG) {
  return (
    gradeResistance_N_per_t(grade_pct) +
    rollingResistance_N_per_t(speed_kmh, cfg) +
    curveResistance_N_per_t(radius_m)
  );
}

/* ------------------------------------------------------------------ */
/* Tractive effort                                                     */
/* ------------------------------------------------------------------ */

/**
 * Back-calculates a locomotive's effective sustained tractive effort from its
 * measured rated load on the reference climb.
 *
 * @param {object} loco  entry from locomotives.json
 * @param {object} [cfg]
 * @returns {number} newtons
 */
export function effectiveTractiveEffort_N(loco, cfg = DEFAULT_CONFIG) {
  const totalMass_t = loco.ratedLoad_t + loco.massFull_t;
  const specific = totalResistance_N_per_t(cfg.refGrade_pct, loco.refSpeed_kmh, null, cfg);
  return totalMass_t * specific;
}

/**
 * Adhesion-limited tractive effort for one locomotive, in newtons.
 * @param {object} loco
 * @param {{wet?: boolean, sand?: boolean}} conditions
 * @param {object} [cfg]
 */
export function adhesionLimit_N(loco, conditions = {}, cfg = DEFAULT_CONFIG) {
  let mu = conditions.wet ? cfg.adhesion.wet : cfg.adhesion.dry;
  if (conditions.sand) mu += cfg.adhesion.sandBonus;
  return mu * loco.adhesiveMass_t * 1000 * G;
}

/* ------------------------------------------------------------------ */
/* Heat                                                                */
/* ------------------------------------------------------------------ */

/**
 * Speed at which a passively-cooled locomotive gets enough airflow to hold
 * its traction motors at equilibrium under a moderate load. Anchored to the
 * documented DE2 behaviour, where the motors settle out around 500 A.
 */
export const PASSIVE_COOLING_REF_KMH = 30;

/**
 * Heat is the constraint the tractive-effort maths misses entirely, and in
 * practice it is what ends most early-game climbs. A DE2 that has plenty of
 * pull in hand will still cook its traction motors if it grinds up a long
 * grade slowly, because its only cooling is the air going past it. Slowing
 * down makes it hotter, which makes it slower.
 *
 * This is a heuristic, not a thermal simulation. It combines how hard you are
 * leaning on the engine with how much cooling the speed is buying you.
 *
 *   index < 0.7   fine
 *   0.7 to 1.0    watch it
 *   above 1.0     expect to overheat on a sustained climb
 *
 * @param {object} args
 * @param {object[]} args.poweredLocos
 * @param {number} args.required_N        force needed to hold the grade
 * @param {number} args.engineTractiveEffort_N
 * @param {number} args.speed_kmh
 * @param {number|null} [args.climbLength_m]
 */
export function assessHeat({
  poweredLocos,
  required_N,
  engineTractiveEffort_N,
  speed_kmh,
  climbLength_m = null
}) {
  const utilisation = engineTractiveEffort_N > 0 ? required_N / engineTractiveEffort_N : Infinity;
  const effectiveSpeed = Math.max(speed_kmh, 5);

  const passive = poweredLocos.some(l => l.cooling === 'passive');
  const steamOnly = poweredLocos.length > 0 && poweredLocos.every(l => l.cooling === 'steam');

  let index;
  if (steamOnly) {
    index = null; // steam runs out of water and fire, not cooling
  } else if (passive) {
    index = utilisation * (PASSIVE_COOLING_REF_KMH / effectiveSpeed);
  } else {
    index = utilisation;
  }

  let level = 'unknown';
  if (index !== null) {
    if (index < 0.7) level = 'ok';
    else if (index <= 1.0) level = 'watch';
    else level = 'overheat';
  }

  const climbMinutes =
    climbLength_m && speed_kmh > 0 ? climbLength_m / (speed_kmh / 3.6) / 60 : null;

  return {
    utilisation,
    index,
    level,
    cooling: steamOnly ? 'steam' : passive ? 'passive' : 'active',
    climbMinutes,
    /**
     * The single most useful piece of advice this tool can give a DE2 driver:
     * the speed at which the heat problem goes away at this load.
     */
    speedToClearHeat_kmh:
      passive && !steamOnly && utilisation > 0
        ? Math.min(120, utilisation * PASSIVE_COOLING_REF_KMH / 0.7)
        : null
  };
}

/* ------------------------------------------------------------------ */
/* Consists                                                            */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} ConsistUnit
 * @property {object} loco      entry from locomotives.json
 * @property {boolean} powered  false means dead-in-train: it still weighs,
 *                              it still takes up length, it pulls nothing
 */

/**
 * Summarises the locomotive end of a consist.
 *
 * MU rules in Derail Valley: DE2, DE6 and DH4 carry MU cables and share
 * controls. DM3, S060, S282 and BE2 do not. Two non-MU locomotives can be
 * physically coupled and each driven by hand, but they cannot be commanded
 * together, so this function reports that rather than silently adding up
 * tractive effort you cannot actually apply in sync.
 *
 * @param {ConsistUnit[]} units
 * @param {{wet?: boolean, sand?: boolean}} conditions
 * @param {object} [cfg]
 */
export function summariseLocos(units, conditions = {}, cfg = DEFAULT_CONFIG) {
  const powered = units.filter(u => u.powered);
  const rawTE = powered.reduce((s, u) => s + effectiveTractiveEffort_N(u.loco, cfg), 0);

  const multiplePowered = powered.length > 1;
  const nonMuPowered = powered.filter(u => !u.loco.mu).map(u => u.loco.id);
  const muPenalty = multiplePowered ? cfg.muEfficiency : 1;

  return {
    count: units.length,
    poweredCount: powered.length,
    poweredLocos: powered.map(u => u.loco),
    mass_t: units.reduce((s, u) => s + u.loco.massFull_t, 0),
    length_m: units.reduce((s, u) => s + u.loco.length_m, 0),
    tractiveEffort_N: rawTE * muPenalty,
    adhesionLimit_N: powered.reduce((s, u) => s + adhesionLimit_N(u.loco, conditions, cfg), 0),
    /** True when the pair cannot actually be MU'd together. */
    muIncompatible: multiplePowered && nonMuPowered.length > 0,
    nonMuPowered,
    muPenaltyApplied: multiplePowered
  };
}

/**
 * The force the locomotives can actually put to the rail: whichever of
 * engine output and wheel-rail friction runs out first.
 */
export function usableTractiveEffort_N(locoSummary) {
  return Math.min(locoSummary.tractiveEffort_N, locoSummary.adhesionLimit_N);
}

/* ------------------------------------------------------------------ */
/* The three questions the tool answers                                */
/* ------------------------------------------------------------------ */

/**
 * Question 1: given this train and this grade, does it climb?
 *
 * @param {object} args
 * @param {object} args.locoSummary   from summariseLocos()
 * @param {number} args.trailingMass_t  everything behind the locomotives
 * @param {number} args.grade_pct       the ruling (steepest sustained) grade
 * @param {number} [args.speed_kmh]     the speed you expect to climb at
 * @param {number|null} [args.radius_m] tightest curve on the climb
 * @param {number} [args.climbLength_m] how long the ruling grade runs
 * @param {number} [args.entrySpeed_kmh] speed at the foot of the climb
 * @param {object} [args.cfg]
 */
export function assessClimb({
  locoSummary,
  trailingMass_t,
  grade_pct,
  speed_kmh = 25,
  radius_m = null,
  climbLength_m = null,
  entrySpeed_kmh = null,
  cfg = DEFAULT_CONFIG
}) {
  const totalMass_t = locoSummary.mass_t + trailingMass_t;
  const specific = totalResistance_N_per_t(grade_pct, speed_kmh, radius_m, cfg);
  const required_N = totalMass_t * specific;
  const usable_N = usableTractiveEffort_N(locoSummary);

  const margin = required_N > 0 ? usable_N / required_N : Infinity;

  let limitedBy = 'power';
  if (locoSummary.adhesionLimit_N < locoSummary.tractiveEffort_N) limitedBy = 'adhesion';

  let verdict;
  if (margin >= cfg.marginComfortable) verdict = 'comfortable';
  else if (margin >= cfg.marginMarginal) verdict = 'marginal';
  else verdict = 'stalls';

  // If it does not make the grade, how far does momentum carry it?
  let stallDistance_m = null;
  let stallTime_s = null;
  if (margin < 1 && entrySpeed_kmh) {
    const deficit_N = required_N - usable_N;
    const decel = deficit_N / (totalMass_t * 1000); // m/s^2
    const v0 = entrySpeed_kmh / 3.6;
    stallDistance_m = (v0 * v0) / (2 * decel);
    stallTime_s = v0 / decel;
  }

  const heat = assessHeat({
    poweredLocos: locoSummary.poweredLocos,
    required_N,
    engineTractiveEffort_N: locoSummary.tractiveEffort_N,
    speed_kmh,
    climbLength_m
  });

  // Heat can defeat a train that has tractive effort to spare, so it gets a
  // say in the verdict rather than being reported off to one side.
  if (heat.level === 'overheat' && verdict === 'comfortable') verdict = 'marginal';

  return {
    totalMass_t,
    required_N,
    usable_N,
    engineTractiveEffort_N: locoSummary.tractiveEffort_N,
    adhesionLimit_N: locoSummary.adhesionLimit_N,
    specificResistance_N_per_t: specific,
    margin,
    verdict,
    limitedBy: heat.level === 'overheat' && limitedBy === 'power' ? 'heat' : limitedBy,
    heat,
    stallDistance_m,
    stallTime_s,
    clearsClimbOnMomentum:
      stallDistance_m !== null && climbLength_m !== null
        ? stallDistance_m >= climbLength_m
        : null
  };
}

/**
 * Question 2: given this locomotive set and this grade, how much can I take?
 *
 * Solves required(M) = usable for M, then subtracts the locomotives to give
 * the payload you can actually couple up behind them.
 */
export function maxTrailingMass_t({
  locoSummary,
  grade_pct,
  speed_kmh = 25,
  radius_m = null,
  cfg = DEFAULT_CONFIG
}) {
  const specific = totalResistance_N_per_t(grade_pct, speed_kmh, radius_m, cfg);
  if (specific <= 0) return Infinity;
  const totalMass_t = usableTractiveEffort_N(locoSummary) / specific;
  return Math.max(0, totalMass_t - locoSummary.mass_t);
}

/**
 * Question 3: going down, how much heat am I making?
 *
 * On a descent the train's potential energy has to go somewhere. Dynamic
 * brakes turn it into waste heat inside the locomotive; friction brakes turn
 * it into heat in the shoes, which is what cooks them. This returns the raw
 * power that must be dissipated to hold a steady speed, which is the number
 * that actually matters and which the game never shows you.
 */
export function descentPower({
  totalMass_t,
  grade_pct,
  speed_kmh,
  radius_m = null,
  cfg = DEFAULT_CONFIG
}) {
  const gradeAssist = gradeResistance_N_per_t(Math.abs(grade_pct)) * totalMass_t;
  const naturalDrag =
    (rollingResistance_N_per_t(speed_kmh, cfg) + curveResistance_N_per_t(radius_m)) * totalMass_t;
  const net_N = gradeAssist - naturalDrag;
  const v = speed_kmh / 3.6;
  return {
    /** Braking force needed to hold the speed. Negative means the train slows on its own. */
    brakingForce_N: net_N,
    /** Power to dissipate, in watts. */
    power_W: Math.max(0, net_N) * v,
    power_kW: Math.max(0, net_N) * v / 1000,
    /** Normalised so you can compare trains of different sizes. */
    power_kW_per_100t: totalMass_t > 0 ? (Math.max(0, net_N) * v / 1000) / (totalMass_t / 100) : 0,
    runsAwayFreely: net_N > 0
  };
}

/* ------------------------------------------------------------------ */
/* Route profiles                                                      */
/* ------------------------------------------------------------------ */

/**
 * Finds the ruling grade in a profile: the steepest sustained climb, which is
 * what actually decides whether the train makes it. A ten-metre spike at 3%
 * is not a ruling grade; six hundred metres at 2.1% is.
 *
 * @param {{grade_pct: number, length_m: number, radius_m?: number|null}[]} segments
 * @param {number} [minSustained_m] segments shorter than this are ignored
 *   for the ruling grade, since momentum carries you over them
 */
export function rulingGrade(segments, minSustained_m = 150) {
  const climbs = segments.filter(s => s.grade_pct > 0);
  if (climbs.length === 0) return null;

  const sustained = climbs.filter(s => s.length_m >= minSustained_m);
  const pool = sustained.length ? sustained : climbs;

  return pool.reduce((worst, s) => (s.grade_pct > worst.grade_pct ? s : worst), pool[0]);
}

/** The steepest descent, for the brake-heat side of the question. */
export function steepestDescent(segments) {
  const drops = segments.filter(s => s.grade_pct < 0);
  if (drops.length === 0) return null;
  return drops.reduce((worst, s) => (s.grade_pct < worst.grade_pct ? s : worst), drops[0]);
}

/**
 * Parses a pasted grade profile. Accepts one segment per line, in the shape
 * the community map shows them:
 *
 *   +2.1 600
 *   -1.4 900 450
 *
 * meaning grade percent, segment length in metres, and optionally the
 * tightest curve radius in metres. Blank lines and # comments are skipped.
 */
export function parseProfile(text) {
  const segments = [];
  const errors = [];
  const lines = String(text || '').split('\n');

  lines.forEach((raw, i) => {
    const line = raw.split('#')[0].trim();
    if (!line) return;
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    const grade = Number(parts[0]);
    const length = Number(parts[1]);
    const radius = parts[2] !== undefined ? Number(parts[2]) : null;

    if (!Number.isFinite(grade) || !Number.isFinite(length) || length <= 0) {
      errors.push({ line: i + 1, text: raw.trim() });
      return;
    }
    segments.push({
      grade_pct: grade,
      length_m: length,
      radius_m: Number.isFinite(radius) && radius > 0 ? radius : null
    });
  });

  return { segments, errors };
}

/* ------------------------------------------------------------------ */
/* Consist assembly                                                    */
/* ------------------------------------------------------------------ */

/**
 * @param {{car: object, count: number, loaded: boolean}[]} entries
 */
export function summariseCars(entries) {
  return entries.reduce(
    (acc, e) => {
      const per = e.car.tare_t + (e.loaded ? e.car.typicalLoad_t : 0);
      acc.mass_t += per * e.count;
      acc.length_m += e.car.length_m * e.count;
      acc.count += e.count;
      return acc;
    },
    { mass_t: 0, length_m: 0, count: 0 }
  );
}

/* ------------------------------------------------------------------ */
/* Recommendation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Question 4: I have this much tonnage and this grade. What do I need?
 *
 * Walks single locomotives first, then MU-capable pairs, and returns every
 * option that clears the job, cheapest licence first. Ordering by licence
 * cost rather than by power is deliberate: the answer a player wants is the
 * least loco that does the job, because bigger licences permanently raise
 * copay and shorten the time bonus.
 */
export function recommendPower({
  locomotives,
  trailingMass_t,
  grade_pct,
  speed_kmh = 25,
  radius_m = null,
  conditions = {},
  cfg = DEFAULT_CONFIG
}) {
  const options = [];

  const consider = units => {
    const summary = summariseLocos(units, conditions, cfg);
    if (summary.muIncompatible) return;
    const result = assessClimb({
      locoSummary: summary,
      trailingMass_t,
      grade_pct,
      speed_kmh,
      radius_m,
      cfg
    });
    if (result.margin >= cfg.marginMarginal) {
      options.push({
        label: units.map(u => u.loco.id).join(' + '),
        licenseCost: units.reduce((s, u) => s + u.loco.licenseCost, 0),
        margin: result.margin,
        limitedBy: result.limitedBy,
        verdict: result.verdict
      });
    }
  };

  for (const loco of locomotives) consider([{ loco, powered: true }]);

  const muCapable = locomotives.filter(l => l.mu);
  for (let i = 0; i < muCapable.length; i++) {
    for (let j = i; j < muCapable.length; j++) {
      consider([
        { loco: muCapable[i], powered: true },
        { loco: muCapable[j], powered: true }
      ]);
    }
  }

  return options.sort(
    (a, b) => a.licenseCost - b.licenseCost || b.margin - a.margin
  );
}
