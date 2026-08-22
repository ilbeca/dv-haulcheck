#!/usr/bin/env node
/**
 * Build sentinel.
 *
 * This tool will not die of a bug. It will die of standing still while the
 * game moves — the figures stay plausible, nobody notices they now describe a
 * version of Derail Valley that no longer exists, and it goes on giving
 * confident answers about the wrong game.
 *
 * So: compare the build the dataset claims to describe against the newest one
 * on the public changelog, and say something when they part company.
 *
 * Two rules govern this script.
 *
 * It never touches the data. Deciding that a figure still holds is a judgement
 * about the game, not about a version string, and no script is in a position
 * to make it.
 *
 * It fails softly. If the changelog is down, or moves, or stops looking like
 * it looks today, this prints a warning and exits 0. A sentinel that turns the
 * repository red because somebody else redesigned their website gets switched
 * off within a fortnight, and a sentinel that has been switched off guards
 * nothing at all.
 */

import { readFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHANGELOG = 'https://changelog.derailvalley.com/';
const TIMEOUT_MS = 20_000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Hand results back to the workflow, when there is a workflow listening. */
function emit(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

/** Give up on the whole exercise without taking the repository down with us. */
function standDown(reason, current = '') {
  console.warn(`\n⚠ Build check skipped: ${reason}`);
  console.warn('  This is deliberate. An unreachable or restructured changelog is not a');
  console.warn('  reason to fail the repository, so nothing is reported as drifted.');
  emit({ drift: 'false', latest: '', current, skipped: 'true' });
  process.exit(0);
}

/**
 * "99.x" is a family, not a version: it says the figures were checked against
 * build 99 and are held to apply across its point releases. A declaration with
 * an explicit minor is read literally instead.
 */
function parseDeclared(value) {
  const m = /^(\d+)(?:\.(\d+|x))?$/i.exec(String(value).trim());
  if (!m) return null;
  const minor = m[2] === undefined || m[2].toLowerCase() === 'x' ? null : Number(m[2]);
  return { major: Number(m[1]), minor, raw: value };
}

/** Every "BUILD 99.7", "Build 91" and "build #88" the page happens to contain. */
function parseBuildsFrom(html) {
  const found = [];
  for (const [, major, minor] of html.matchAll(/build\s*#?\s*(\d+)(?:\.(\d+))?/gi)) {
    found.push({ major: Number(major), minor: minor === undefined ? 0 : Number(minor) });
  }
  return found;
}

const higher = (a, b) => (a.major !== b.major ? a.major > b.major : a.minor > b.minor);
const format = b => (b.minor ? `${b.major}.${b.minor}` : `${b.major}`);

/* ---------------------------------------------------------------- */

const declaredRaw = JSON.parse(readFileSync(join(root, 'data', 'locomotives.json'), 'utf8')).gameBuild;
const declared = parseDeclared(declaredRaw);

if (!declared) {
  standDown(`gameBuild in data/locomotives.json is "${declaredRaw}", which is not a build number`);
}

let html;
try {
  const response = await fetch(CHANGELOG, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'haulcheck-build-watch (github.com/ilbeca/dv-haulcheck)' }
  });
  if (!response.ok) standDown(`${CHANGELOG} answered ${response.status}`, declared.raw);
  html = await response.text();
} catch (error) {
  standDown(`could not reach ${CHANGELOG} — ${error.message}`, declared.raw);
}

const builds = parseBuildsFrom(html);
if (builds.length === 0) {
  standDown('no build numbers found on the changelog; its markup has probably changed', declared.raw);
}

const latest = builds.reduce((best, b) => (higher(b, best) ? b : best));

// A declared family drifts only when the major moves on. An explicitly pinned
// minor drifts as soon as anything newer ships.
const drift =
  declared.minor === null
    ? latest.major > declared.major
    : latest.major > declared.major || (latest.major === declared.major && latest.minor > declared.minor);

console.log(`Declared in data/locomotives.json : ${declared.raw}`);
console.log(`Newest build on the changelog     : ${format(latest)}`);
console.log(`Build numbers seen on the page    : ${builds.length}`);
console.log('');

if (drift) {
  console.log(`✗ DRIFT — the dataset describes ${declared.raw}, the game is on ${format(latest)}.`);
  console.log('  The figures need re-checking against the new build before gameBuild moves.');
} else if (declared.minor === null && latest.major === declared.major) {
  console.log(`✓ No drift — ${format(latest)} is within the declared ${declared.raw} family.`);
} else {
  console.log('✓ No drift — the dataset is current.');
}

emit({ drift: String(drift), latest: format(latest), current: declared.raw, skipped: 'false' });
