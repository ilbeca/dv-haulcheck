/**
 * Deployment sanity checks.
 *
 * physics.test.mjs asks whether the model is right. This file asks a blunter
 * question: if we published the repository exactly as it stands, would the
 * page still work?
 *
 * The distinction matters here more than on most projects. A typo in
 * locomotives.json does not produce a blank page or a stack trace the visitor
 * can see — the site loads, the sliders move, and it quietly serves wrong
 * numbers to somebody deciding whether to couple up forty more tonnes. These
 * tests are the gate that stops that reaching Pages.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

const dataFiles = readdirSync(join(root, 'data')).filter(f => f.endsWith('.json'));

test('every data file is valid JSON', () => {
  assert.ok(dataFiles.length > 0, 'there should be data files to check');

  for (const file of dataFiles) {
    // The parse error alone is unhelpful once it reaches the browser console,
    // so name the file in the failure.
    assert.doesNotThrow(
      () => JSON.parse(read(join('data', file))),
      new RegExp('.'),
      `data/${file} is not parseable JSON`
    );
  }
});

test('physics.js imports in Node, which proves it stayed free of the DOM', async () => {
  // The module is the reusable half of this project and the architecture rule
  // says it must not reach for `document` or `window`. Node has neither, so a
  // clean import here is the cheapest possible enforcement of that rule.
  const physics = await import('../js/physics.js');

  assert.equal(typeof physics.assessClimb, 'function');
  assert.equal(typeof physics.summariseLocos, 'function');
});

test('locomotive ids are unique', () => {
  const ids = JSON.parse(read('data/locomotives.json')).locomotives.map(l => l.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);

  assert.deepEqual(duplicates, [], `duplicate locomotive ids: ${duplicates.join(', ')}`);
});

test('car ids are unique', () => {
  // A duplicate id is silent: the consist builder looks one up, gets the first
  // match, and every later entry with that id becomes unreachable.
  const ids = JSON.parse(read('data/cars.json')).cars.map(c => c.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);

  assert.deepEqual(duplicates, [], `duplicate car ids: ${duplicates.join(', ')}`);
});

test('every locomotive carries the fields the model reads', () => {
  const numeric = [
    'massFull_t',
    'length_m',
    'adhesiveMass_t',
    'ratedLoad_t',
    'refSpeed_kmh',
    'licenseCost'
  ];

  for (const loco of JSON.parse(read('data/locomotives.json')).locomotives) {
    for (const field of numeric) {
      // A missing field arrives in the maths as undefined and comes out as
      // NaN, which renders as an empty box rather than as an error.
      assert.ok(
        Number.isFinite(loco[field]),
        `${loco.id}.${field} must be a finite number, got ${JSON.stringify(loco[field])}`
      );
      assert.ok(loco[field] >= 0, `${loco.id}.${field} must not be negative`);
    }

    assert.equal(typeof loco.mu, 'boolean', `${loco.id}.mu must be a boolean`);

    // Not merely a string: an unrecognised value would fall through to the
    // active-cooling branch, and the tool would stop warning about the one
    // failure mode it exists to warn about.
    assert.ok(
      ['passive', 'active', 'steam'].includes(loco.cooling),
      `${loco.id}.cooling must be passive, active or steam, got ${JSON.stringify(loco.cooling)}`
    );

    assert.ok(
      loco.adhesiveMass_t <= loco.massFull_t,
      `${loco.id} cannot put more mass on its driven axles than it weighs`
    );
  }
});

test('every local file the page asks for exists on disk', () => {
  const referenced = new Set();

  // What the markup pulls in: stylesheets, scripts, icons.
  const html = read('index.html');
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    referenced.add(url);
  }

  // Meta tags carry prose as well as paths, so only take the values that look
  // like a file. Absolute preview URLs fall out at the protocol filter below.
  for (const [, value] of html.matchAll(/content="([^"]+)"/g)) {
    if (!/\s/.test(value) && /\.(png|jpe?g|svg|webp|ico|css|js|json)$/i.test(value)) {
      referenced.add(value);
    }
  }

  // What the scripts fetch or import at runtime. The data files are reached
  // this way rather than from the markup, so scanning the HTML alone would
  // miss exactly the files most likely to be renamed.
  for (const script of readdirSync(join(root, 'js')).filter(f => f.endsWith('.js'))) {
    const source = read(join('js', script));

    for (const [, url] of source.matchAll(/fetch\(\s*['"]([^'"]+)['"]/g)) {
      referenced.add(url);
    }
    for (const [, url] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      // Relative to the importing module, not to the repository root.
      referenced.add(posix.join('js', url));
    }
  }

  const local = [...referenced].filter(
    url => !/^(https?:|data:|mailto:|#|\/\/)/.test(url) && url.trim() !== ''
  );

  assert.ok(local.length > 0, 'the page should reference at least one local file');

  const missing = local.filter(url => !existsSync(join(root, url.split(/[?#]/)[0])));
  assert.deepEqual(missing, [], `referenced but absent from the repository: ${missing.join(', ')}`);
});
