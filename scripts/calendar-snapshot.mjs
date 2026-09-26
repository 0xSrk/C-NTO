/**
 * Régénère `src/engine/calendar-bundle/<année>.json`.
 *
 *   npm run calendar:snapshot                  réseau (mêmes adaptateurs que le desk)
 *   npm run calendar:snapshot -- --from-fixtures
 *   npm run calendar:snapshot --from-fixtures  (npm pose npm_config_from_fixtures)
 *
 * `--from-fixtures` lit `tests/fixtures/calendar/` au lieu du réseau.
 * Une source en échec arrête l'écriture, sauf `--allow-partial` qui reprend
 * les événements de cette institution depuis le fichier précédent.
 *
 * Aucune dépendance ajoutée : les parseurs sont compilés avec le `tsc` déjà là.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const ORIGINS = ['bls', 'bea', 'fed', 'ecb', 'eia', 'treasury'];
const ECB_ATTRIBUTION = 'Source : Banque centrale européenne, réutilisation avec attribution';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name) || process.env[`npm_config_${name.slice(2).replace(/-/g, '_')}`] === 'true';
const fromFixtures = flag('--from-fixtures');
const allowPartial = flag('--allow-partial');

function option(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const year = new Date().getUTCFullYear();
const coverage = { from: `${year}-01-01`, to: `${year + 1}-03-31` };
const defaultOut = path.join(root, 'src', 'engine', 'calendar-bundle', `${year}.json`);
const destination = path.resolve(option('--out') ?? defaultOut);
const fixtureDir = path.resolve(option('--fixtures') ?? path.join(root, 'tests', 'fixtures', 'calendar'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function compileParsers() {
  const tsc = path.join(root, 'node_modules', 'typescript', 'lib', 'tsc.js');
  if (!existsSync(tsc)) fail('typescript est introuvable : le script ne peut pas compiler les parseurs.');
  const out = path.join(root, '.cache', 'calendar-snapshot');
  mkdirSync(out, { recursive: true });
  const run = spawnSync(process.execPath, [tsc, '-p', 'electron/tsconfig.snapshot.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    fail(`compilation des parseurs\n${run.stdout ?? ''}${run.stderr ?? ''}`);
  }
  return out;
}

function loadParsers(outDir) {
  const calendar = path.join(outDir, 'calendar');
  return {
    bls: require(path.join(calendar, 'bls.js')),
    bea: require(path.join(calendar, 'bea.js')),
    fed: require(path.join(calendar, 'fed.js')),
    ecb: require(path.join(calendar, 'ecb.js')),
    eia: require(path.join(calendar, 'eia.js')),
    treasury: require(path.join(calendar, 'treasury.js')),
    dates: require(path.join(calendar, 'dates.js')),
  };
}

function readFixture(name) {
  const file = path.join(fixtureDir, name);
  if (!existsSync(file)) throw new Error(`fixture absente : ${name}`);
  return readFileSync(file, 'utf8');
}

function deskFetch(url, init) {
  const headers = new Headers(init?.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', 'CANTO-Desk/2.0 (calendar)');
  return fetch(url, { ...init, headers });
}

async function collect(parsers) {
  const { inRange } = parsers.dates;
  const ctx = { fetch: deskFetch, locale: 'fr' };
  const jobs = {
    bls: async () => {
      if (fromFixtures) {
        let rows = [
          ...parsers.bls.parseBlsSchedule(readFixture('bls-empsit.html'), 'empsit'),
          ...parsers.bls.parseBlsSchedule(readFixture('bls-cpi.html'), 'cpi'),
        ];
        rows = parsers.bls.applyBlsValues(rows, JSON.parse(readFixture('bls-api.json')));
        return rows.filter((row) => inRange(row.date, coverage));
      }
      return parsers.bls.blsAdapter.fetch(coverage, ctx);
    },
    bea: async () => {
      if (fromFixtures) return parsers.bea.parseBeaSchedule(readFixture('bea.html')).filter((row) => inRange(row.date, coverage));
      return parsers.bea.beaAdapter.fetch(coverage, ctx);
    },
    fed: async () => {
      if (fromFixtures) return parsers.fed.parseFedSchedule(readFixture('fed.html')).filter((row) => inRange(row.date, coverage));
      return parsers.fed.fedAdapter.fetch(coverage, ctx);
    },
    ecb: async () => {
      if (fromFixtures) return parsers.ecb.parseEcbCalendar(readFixture('ecb.html')).filter((row) => inRange(row.date, coverage));
      return parsers.ecb.ecbAdapter.fetch(coverage, ctx);
    },
    eia: async () => {
      if (fromFixtures) return parsers.eia.parseEiaSchedule(readFixture('eia.html'), coverage);
      return parsers.eia.eiaAdapter.fetch(coverage, ctx);
    },
    treasury: async () => {
      if (fromFixtures) return parsers.treasury.parseTreasuryAuctions(JSON.parse(readFixture('treasury.json'))).filter((row) => inRange(row.date, coverage));
      return parsers.treasury.treasuryAdapter.fetch(coverage, ctx);
    },
  };

  const events = [];
  const failed = [];
  for (const origin of ORIGINS) {
    try {
      const rows = await jobs[origin]();
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('aucun événement');
      events.push(...rows.map((row) => toStored(row, origin)));
      console.log(`${origin} : ${rows.length}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'échec';
      failed.push({ origin, message });
      console.error(`${origin} : ${message}`);
    }
  }
  return { events, failed };
}

function toStored(row, origin) {
  const prefix = `${origin}:`;
  if (typeof row.id !== 'string' || !row.id.startsWith(prefix)) {
    throw new Error(`identifiant inattendu pour ${origin} : ${row.id}`);
  }
  return stored({
    origin,
    key: row.id.slice(prefix.length),
    date: row.date,
    timeET: row.timeET,
    at: row.at,
    title: row.title,
    category: row.category,
    impact: row.impact,
    currency: row.currency,
    instruments: row.instruments,
    previous: row.previous,
    actual: row.actual,
    forecast: row.forecast,
    period: row.period,
    estimated: row.estimated,
  });
}

function stored(event) {
  if (!ORIGINS.includes(event.origin)) return null;
  if (typeof event.key !== 'string' || event.key.length === 0) return null;
  if (typeof event.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return null;
  if (typeof event.title !== 'string' || event.title.length === 0) return null;
  if (event.impact !== 1 && event.impact !== 2 && event.impact !== 3) return null;
  if (typeof event.estimated !== 'boolean') return null;
  const out = {
    origin: event.origin,
    key: event.key,
    date: event.date,
  };
  if (typeof event.timeET === 'string' && event.timeET) out.timeET = event.timeET;
  if (typeof event.at === 'string' && event.at) out.at = event.at;
  out.title = event.title;
  out.category = event.category;
  out.impact = event.impact;
  if (typeof event.currency === 'string' && event.currency) out.currency = event.currency;
  out.instruments = Array.isArray(event.instruments) ? event.instruments.filter((s) => typeof s === 'string') : [];
  if (typeof event.previous === 'string' && event.previous) out.previous = event.previous;
  if (typeof event.actual === 'string' && event.actual) out.actual = event.actual;
  if (typeof event.forecast === 'string' && event.forecast) out.forecast = event.forecast;
  if (typeof event.period === 'string' && event.period) out.period = event.period;
  out.estimated = event.estimated;
  return out;
}

function readPrevious(file) {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.events)) return [];
    return parsed.events.map(stored).filter(Boolean);
  } catch {
    return null;
  }
}

function dedupe(events) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    let key = event.key;
    let n = 2;
    while (seen.has(`${event.origin}:${key}`)) key = `${event.key}-${n++}`;
    const next = key === event.key ? event : { ...event, key };
    seen.add(`${next.origin}:${next.key}`);
    out.push(next);
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.timeET ?? '').localeCompare(b.timeET ?? '') || a.origin.localeCompare(b.origin) || a.key.localeCompare(b.key));
  return out;
}

function writeBundle(events) {
  const doc = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    coverage,
    attribution: { ecb: ECB_ATTRIBUTION },
    events,
  };
  const tmp = `${destination}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, destination);
}

async function main() {
  console.log(fromFixtures ? 'lecture : fixtures' : 'lecture : réseau');
  const outDir = compileParsers();
  const parsers = loadParsers(outDir);
  const { events, failed } = await collect(parsers);
  let merged = events.filter(Boolean);

  if (failed.length && !allowPartial) {
    const names = failed.map((f) => f.origin).join(', ');
    fail(`Instantané incomplet, aucune écriture. Sources en échec : ${names}`);
  }

  if (failed.length && allowPartial) {
    const previous = readPrevious(destination);
    if (!previous) fail(`--allow-partial sans instantané précédent lisible. Sources en échec : ${failed.map((f) => f.origin).join(', ')}`);
    for (const { origin } of failed) {
      const kept = previous.filter((event) => event.origin === origin);
      merged.push(...kept);
      console.log(`${origin} : ${kept.length} événement(s) conservé(s) depuis l'instantané précédent`);
    }
  }

  merged = dedupe(merged);
  if (merged.length === 0) fail('Instantané vide, aucune écriture.');
  writeBundle(merged);
  const counts = Object.fromEntries(ORIGINS.map((origin) => [origin, merged.filter((event) => event.origin === origin).length]));
  console.log(`écrit ${path.relative(root, destination)} (${merged.length}) ${JSON.stringify(counts)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    rmSync(`${destination}.${process.pid}.tmp`, { force: true });
    fail(err instanceof Error ? err.message : 'échec');
  });
}
