import {
  summariseLocos,
  summariseCars,
  assessClimb,
  maxTrailingMass_t,
  descentPower,
  rulingGrade,
  steepestDescent,
  parseProfile,
  recommendPower
} from './physics.js';

const $ = id => document.getElementById(id);

let LOCOS = [];
let CARS = [];
let locoRows = [];   // { id, powered }
let carRows = [];    // { id, count, loaded }
let mode = 'direct';
let worstDescent = null;

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    const [locoData, carData] = await Promise.all([
      fetch('data/locomotives.json').then(r => r.json()),
      fetch('data/cars.json').then(r => r.json())
    ]);
    LOCOS = locoData.locomotives;
    CARS = carData.cars;
  } catch (err) {
    $('verdictCall').textContent = 'Data did not load';
    $('verdictBecause').textContent =
      'The locomotive and car tables could not be read. If you opened this file directly from disk, serve the folder over HTTP instead — browsers block fetch on file:// URLs.';
    return;
  }

  if (!readStateFromUrl()) {
    locoRows = [{ id: 'DE2', powered: true }];
    carRows = [];
  }

  renderLocoRows();
  renderCarRows();
  wire();
  recalc();
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function renderLocoRows() {
  const host = $('locoList');
  host.textContent = '';

  locoRows.forEach((row, i) => {
    const el = document.createElement('div');
    el.className = 'row';

    const select = document.createElement('select');
    select.setAttribute('aria-label', `Locomotive ${i + 1}`);
    LOCOS.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = `${l.id} — ${l.name}`;
      if (l.id === row.id) opt.selected = true;
      select.append(opt);
    });
    select.addEventListener('change', () => { row.id = select.value; recalc(); });

    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = row.powered;
    cb.addEventListener('change', () => { row.powered = cb.checked; recalc(); });
    const txt = document.createElement('span');
    txt.textContent = 'running';
    toggle.append(cb, txt);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--ghost btn--tiny';
    remove.textContent = 'Remove';
    remove.disabled = locoRows.length === 1;
    remove.addEventListener('click', () => {
      locoRows.splice(i, 1);
      renderLocoRows();
      recalc();
    });

    el.append(select, toggle, remove);
    host.append(el);
  });
}

function renderCarRows() {
  const host = $('carList');
  host.textContent = '';

  carRows.forEach((row, i) => {
    const el = document.createElement('div');
    el.className = 'row';

    const select = document.createElement('select');
    select.setAttribute('aria-label', `Car type ${i + 1}`);
    CARS.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id === row.id) opt.selected = true;
      select.append(opt);
    });
    select.addEventListener('change', () => { row.id = select.value; recalc(); });

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.className = 'row__qty';
    qty.min = '1';
    qty.value = row.count;
    qty.setAttribute('aria-label', 'How many');
    qty.addEventListener('input', () => {
      row.count = Math.max(1, Number(qty.value) || 1);
      recalc();
    });

    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = row.loaded;
    cb.addEventListener('change', () => { row.loaded = cb.checked; recalc(); });
    const txt = document.createElement('span');
    txt.textContent = 'loaded';
    toggle.append(cb, txt);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--ghost btn--tiny';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      carRows.splice(i, 1);
      renderCarRows();
      recalc();
    });

    el.append(select, qty, toggle, remove);
    host.append(el);
  });
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function wire() {
  ['grade', 'speed', 'climbLength', 'entrySpeed', 'radius', 'trailingMass',
   'trailingLength', 'trackLength', 'wet', 'sand'].forEach(id => {
    $(id).addEventListener('input', recalc);
  });

  $('addLoco').addEventListener('click', () => {
    if (locoRows.length >= 4) return;
    locoRows.push({ id: locoRows.at(-1)?.id ?? 'DE2', powered: true });
    renderLocoRows();
    recalc();
  });

  $('addCar').addEventListener('click', () => {
    carRows.push({ id: 'hopper', count: 4, loaded: true });
    renderCarRows();
    recalc();
  });

  document.querySelectorAll('.segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.segmented__btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      mode = btn.dataset.mode;
      $('modeDirect').hidden = mode !== 'direct';
      $('modeBuild').hidden = mode !== 'build';
      if (mode === 'build' && carRows.length === 0) {
        carRows.push({ id: 'hopper', count: 6, loaded: true });
        renderCarRows();
      }
      recalc();
    });
  });

  $('applyProfile').addEventListener('click', applyProfile);
  $('copyLink').addEventListener('click', copyLink);
}

function applyProfile() {
  const { segments, errors } = parseProfile($('profile').value);
  const out = $('profileResult');

  if (segments.length === 0) {
    out.textContent = 'No readable segments. Each line needs a grade and a length.';
    return;
  }

  const ruling = rulingGrade(segments);
  worstDescent = steepestDescent(segments);

  if (!ruling) {
    out.textContent = 'That profile is downhill all the way. Check the descent figures below.';
  } else {
    $('grade').value = ruling.grade_pct.toFixed(1);
    $('climbLength').value = Math.round(ruling.length_m);
    if (ruling.radius_m) $('radius').value = Math.round(ruling.radius_m);
    const skipped = errors.length ? ` ${errors.length} line(s) skipped.` : '';
    out.textContent =
      `Ruling grade ${ruling.grade_pct > 0 ? '+' : ''}${ruling.grade_pct}% over ${Math.round(ruling.length_m)} m.` + skipped;
  }

  recalc();
}

/* ------------------------------------------------------------------ */
/* Calculation                                                         */
/* ------------------------------------------------------------------ */

function currentTrailing() {
  if (mode === 'build') {
    const entries = carRows
      .map(r => ({ car: CARS.find(c => c.id === r.id), count: r.count, loaded: r.loaded }))
      .filter(e => e.car);
    const s = summariseCars(entries);
    $('carTally').textContent = s.count
      ? `${s.count} cars · ${Math.round(s.mass_t)} t · ${Math.round(s.length_m)} m`
      : 'Nothing coupled up yet.';
    return { mass_t: s.mass_t, length_m: s.length_m, cars: s.count };
  }
  return {
    mass_t: Number($('trailingMass').value) || 0,
    length_m: Number($('trailingLength').value) || 0,
    cars: null
  };
}

function recalc() {
  const grade = Number($('grade').value);
  const speed = Math.max(3, Number($('speed').value) || 25);
  const climbLength = Number($('climbLength').value) || null;
  const entrySpeed = Number($('entrySpeed').value) || null;
  const radius = Number($('radius').value) || null;
  const conditions = { wet: $('wet').checked, sand: $('sand').checked };

  updateSign(grade);

  const trailing = currentTrailing();
  const units = locoRows
    .map(r => ({ loco: LOCOS.find(l => l.id === r.id), powered: r.powered }))
    .filter(u => u.loco);

  const locoSummary = summariseLocos(units, conditions);

  // A downhill grade is not a climb. Assess the climb at zero and let the
  // descent figures carry the answer.
  const climbGrade = Math.max(0, grade);

  const result = assessClimb({
    locoSummary,
    trailingMass_t: trailing.mass_t,
    grade_pct: climbGrade,
    speed_kmh: speed,
    radius_m: radius,
    climbLength_m: climbLength,
    entrySpeed_kmh: entrySpeed
  });

  const headroom = maxTrailingMass_t({
    locoSummary,
    grade_pct: climbGrade,
    speed_kmh: speed,
    radius_m: radius
  });

  const descentGrade = grade < 0 ? grade : (worstDescent ? worstDescent.grade_pct : null);
  const descent = descentGrade
    ? descentPower({
        totalMass_t: result.totalMass_t,
        grade_pct: descentGrade,
        speed_kmh: speed,
        radius_m: radius
      })
    : null;

  paintVerdict(result, locoSummary, grade);
  paintForces(result);
  paintReadout(result, headroom, descent, trailing, locoSummary);
  paintNotes(result, locoSummary, headroom, trailing, descent, descentGrade, units);
  paintOptions(trailing.mass_t, climbGrade, speed, radius, conditions);
  writeStateToUrl();
}

/* ------------------------------------------------------------------ */
/* Painting                                                            */
/* ------------------------------------------------------------------ */

function updateSign(grade) {
  const sign = $('sign');
  const line = $('slopeLine');
  const state = grade > 0.05 ? 'up' : grade < -0.05 ? 'down' : 'flat';
  sign.dataset.state = state;
  $('signNumber').textContent = `${grade > 0 ? '+' : ''}${grade.toFixed(1)}`;

  // The diagonal exaggerates the real gradient so it reads at a glance,
  // the way the in-game boards do.
  const tilt = Math.max(-34, Math.min(34, grade * 13));
  line.setAttribute('y1', String(50 + tilt));
  line.setAttribute('y2', String(50 - tilt));
}

function paintVerdict(result, locoSummary, grade) {
  const box = $('verdict');
  const call = $('verdictCall');
  const why = $('verdictBecause');

  if (grade <= 0.05) {
    box.dataset.verdict = 'comfortable';
    call.textContent = 'No climb to worry about';
    why.textContent = grade < -0.05
      ? 'This is a descent. Tractive effort is not your problem here — holding the speed is. See the braking figures below.'
      : 'Level track. Anything you can start, you can keep moving.';
    return;
  }

  box.dataset.verdict = result.verdict;

  const reasons = {
    power: 'The engine simply does not make enough force for this weight on this grade.',
    adhesion: 'The wheels give up before the engine does — you are grip-limited, not power-limited.',
    heat: 'There is pull to spare, but not enough cooling. This is the failure that catches people out, because the train feels fine right up until it stops.'
  };

  if (result.verdict === 'stalls') {
    call.textContent = 'It stalls';
    why.textContent = reasons[result.limitedBy];
  } else if (result.verdict === 'marginal') {
    call.textContent = result.limitedBy === 'heat' ? 'It climbs, then overheats' : 'Marginal';
    why.textContent = result.limitedBy === 'heat'
      ? reasons.heat
      : `Only ${Math.round((result.margin - 1) * 100)}% in hand. A wet rail, a tighter curve than you expected, or a slow start will take that away.`;
  } else {
    call.textContent = 'It climbs';
    why.textContent = `${Math.round((result.margin - 1) * 100)}% of force in hand at ${$('speed').value} km/h.`;
  }
}

function paintForces(result) {
  const engine = result.engineTractiveEffort_N;
  const grip = result.adhesionLimit_N;
  const need = result.required_N;

  const scale = Math.max(engine, grip, need) * 1.12 || 1;
  const pct = v => `${Math.min(100, (v / scale) * 100)}%`;

  $('barNeed').style.width = pct(need);
  $('barNeedLabel').textContent = `${Math.round(need / 1000)} kN needed`;

  $('markEngine').style.left = pct(engine);
  $('markEngine').textContent = `engine ${Math.round(engine / 1000)}`;
  $('markGrip').style.left = pct(grip);
  $('markGrip').textContent = `grip ${Math.round(grip / 1000)}`;
}

function item(key, val, unit, sub) {
  return `<div class="readout__item">
    <dt class="readout__key">${key}</dt>
    <dd class="readout__val">${val}${unit ? `<small>${unit}</small>` : ''}${sub ? `<small>${sub}</small>` : ''}</dd>
  </div>`;
}

function paintReadout(result, headroom, descent, trailing, locoSummary) {
  const parts = [
    item('Total train', Math.round(result.totalMass_t), 't'),
    item('Force needed', Math.round(result.required_N / 1000), 'kN'),
    item('Force available', Math.round(result.usable_N / 1000), 'kN'),
    item('Most you could take', Math.round(headroom), 't', 'behind the locos')
  ];

  if (result.heat.index !== null) {
    parts.push(item('Heat index', result.heat.index.toFixed(2), '', result.heat.level));
  }
  if (result.heat.climbMinutes) {
    parts.push(item('Time on the grade', result.heat.climbMinutes.toFixed(1), 'min'));
  }
  if (descent) {
    parts.push(item('Braking power', Math.round(descent.power_kW), 'kW', 'to hold speed'));
  }

  const totalLength = locoSummary.length_m + trailing.length_m;
  if (trailing.length_m > 0) {
    parts.push(item('Train length', Math.round(totalLength), 'm'));
  }

  $('readout').innerHTML = parts.join('');
}

function note(kind, html) {
  return `<p class="note note--${kind}">${html}</p>`;
}

function paintNotes(result, locoSummary, headroom, trailing, descent, descentGrade, units) {
  const out = [];

  if (locoSummary.muIncompatible) {
    out.push(note('bad',
      `<strong>These locomotives cannot be multiple-united.</strong> ${locoSummary.nonMuPowered.join(' and ')} carries no MU cable, so the controls will not be shared. You can couple them and drive them one at a time, but the combined figures above assume something the game will not let you do.`));
  }

  if (result.limitedBy === 'adhesion') {
    out.push(note('warn',
      `<strong>Grip runs out before power does.</strong> More throttle only makes the wheels spin. ${$('sand').checked ? 'You are already sanding.' : 'Try sanding — it is worth about a sixth more grip.'} Otherwise the answer is less weight, not more engine.`));
  }

  if (result.heat.level === 'overheat' && result.heat.speedToClearHeat_kmh) {
    out.push(note('bad',
      `<strong>Cooling is the binding constraint.</strong> This locomotive is cooled by the air going past it, so grinding uphill slowly is the worst thing you can do — losing speed makes it hotter, which loses you more speed. Get over the grade at about <strong>${Math.round(result.heat.speedToClearHeat_kmh)} km/h</strong> and the problem goes away. Back up in the yard first if you need the run-up.`));
  } else if (result.heat.level === 'watch') {
    out.push(note('warn',
      `<strong>Watch the temperature.</strong> You are leaning on the engine hard enough that a long grade will heat it up. Fine for a short pull, risky for a sustained one.`));
  }

  if (result.stallDistance_m !== null) {
    const d = Math.round(result.stallDistance_m);
    if (result.clearsClimbOnMomentum) {
      out.push(note('good',
        `<strong>Momentum gets you over.</strong> You cannot hold this grade, but hitting it at ${$('entrySpeed').value} km/h carries you about ${d} m before you stop — and the climb is only ${$('climbLength').value} m. It will be slow and ugly at the top.`));
    } else {
      out.push(note('bad',
        `<strong>You stall about ${d} m up.</strong> Entering at ${$('entrySpeed').value} km/h buys you roughly ${Math.round(result.stallTime_s)} seconds. The climb is ${$('climbLength').value} m, so a run-up will not save this one.`));
    }
  }

  if (descent && descentGrade) {
    if (descent.power_kW_per_100t > 200) {
      out.push(note('bad',
        `<strong>That descent is a brake-cooker.</strong> Holding ${$('speed').value} km/h down ${descentGrade}% means shedding ${Math.round(descent.power_kW)} kW continuously. Friction brakes turn all of that into heat in the shoes. Use dynamic braking if the locomotive has it, and go down slower than feels necessary.`));
    } else if (descent.runsAwayFreely) {
      out.push(note('warn',
        `<strong>${Math.round(descent.power_kW)} kW to dissipate on the way down.</strong> Gravity beats rolling resistance here, so the train accelerates on its own if you leave it alone.`));
    }
  }

  const trackLength = Number($('trackLength').value) || 0;
  const totalLength = locoSummary.length_m + trailing.length_m;
  if (trackLength > 0 && trailing.length_m > 0) {
    if (totalLength > trackLength) {
      out.push(note('warn',
        `<strong>It will not fit.</strong> ${Math.round(totalLength)} m of train into a ${trackLength} m track. Freight haul deliveries need the whole consist inside the destination track before the job validates — locomotives included.`));
    } else {
      out.push(note('good',
        `Fits the destination track with ${Math.round(trackLength - totalLength)} m to spare.`));
    }
  }

  if (headroom > trailing.mass_t * 1.6 && result.verdict === 'comfortable') {
    out.push(note('good',
      `<strong>You are overpowered for this job.</strong> This setup would take ${Math.round(headroom)} t. Consider a smaller locomotive, or couple another job on and make one trip pay twice.`));
  }

  const steamers = units.filter(u => u.powered && u.loco.transmission === 'steam');
  if (steamers.length) {
    out.push(note('warn',
      `<strong>Watch the water, not the tractive effort.</strong> On a steam locomotive the thing that ends a long haul is usually the tank running dry, and that is not something this tool models.`));
  }

  $('notes').innerHTML = out.join('');
}

function paintOptions(trailingMass, grade, speed, radius, conditions) {
  const host = $('options');

  if (grade <= 0.05) {
    host.innerHTML = '<li class="option"><span class="option__meta">Set a climbing grade to compare locomotives.</span></li>';
    return;
  }

  const options = recommendPower({
    locomotives: LOCOS,
    trailingMass_t: trailingMass,
    grade_pct: grade,
    speed_kmh: speed,
    radius_m: radius,
    conditions
  });

  if (options.length === 0) {
    host.innerHTML = `<li class="option"><span class="option__meta">Nothing in the valley takes ${Math.round(trailingMass)} t up ${grade}% at ${speed} km/h. Split the job.</span></li>`;
    return;
  }

  host.innerHTML = options.slice(0, 6).map(o => `
    <li class="option">
      <span class="option__name">${o.label}</span>
      <span class="option__meta">
        ${o.licenseCost === 0 ? 'no licence needed' : '$' + o.licenseCost.toLocaleString('en-US')}<br>
        ${Math.round((o.margin - 1) * 100)}% in hand · ${o.limitedBy}-limited
      </span>
    </li>`).join('');
}

/* ------------------------------------------------------------------ */
/* Shareable state                                                     */
/* ------------------------------------------------------------------ */

function writeStateToUrl() {
  const state = {
    l: locoRows.map(r => `${r.id}${r.powered ? '' : '*'}`).join(','),
    m: $('trailingMass').value,
    g: $('grade').value,
    s: $('speed').value,
    c: $('climbLength').value,
    e: $('entrySpeed').value,
    r: $('radius').value,
    w: $('wet').checked ? 1 : 0,
    n: $('sand').checked ? 1 : 0
  };
  const q = new URLSearchParams(state).toString();
  history.replaceState(null, '', `#${q}`);
}

function readStateFromUrl() {
  if (!location.hash || location.hash.length < 2) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has('l')) return false;

  locoRows = p.get('l').split(',').filter(Boolean).map(tok => ({
    id: tok.replace('*', ''),
    powered: !tok.includes('*')
  }));
  if (locoRows.length === 0) locoRows = [{ id: 'DE2', powered: true }];

  const set = (id, key) => { if (p.has(key)) $(id).value = p.get(key); };
  set('trailingMass', 'm');
  set('grade', 'g');
  set('speed', 's');
  set('climbLength', 'c');
  set('entrySpeed', 'e');
  set('radius', 'r');
  $('wet').checked = p.get('w') === '1';
  $('sand').checked = p.get('n') === '1';
  return true;
}

async function copyLink() {
  const btn = $('copyLink');
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = 'Link copied';
  } catch {
    btn.textContent = 'Copy the address bar instead';
  }
  setTimeout(() => { btn.textContent = 'Copy a link to this setup'; }, 2200);
}

boot();
