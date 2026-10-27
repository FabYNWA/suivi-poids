// Logique pure de l'appli (aucun accès au navigateur), testée dans tests/logic.test.mjs.
//
// Une ligne de données : { d, p, mg, mm, mh, gv }
//   d  = date, en secondes, à minuit UTC (même format que Grist)
//   p  = poids (kg), mg = masse grasse (%), mm = masse musculaire (%),
//   mh = masse hydrique (%), gv = graisse viscérale (indice)

export const DAY = 86400;
export const WINDOW_DAYS = 30;

// better = le sens qui est une amélioration (vert) : 'low' = plus bas, 'high' = plus haut.
export const METRICS = [
  { key: 'p', label: 'Poids', short: 'Poids', unit: 'kg', better: 'low', min: 30, max: 250 },
  { key: 'mg', label: 'Masse grasse', short: 'Gras', unit: '%', better: 'low', min: 1, max: 70 },
  { key: 'mm', label: 'Masse musculaire', short: 'Muscle', unit: '%', better: 'high', min: 10, max: 90 },
  { key: 'mh', label: 'Masse hydrique', short: 'Eau', unit: '%', better: 'high', min: 20, max: 90 },
  { key: 'gv', label: 'Graisse viscérale', short: 'Visc.', unit: '', better: 'low', min: 0, max: 60 },
];

export const RANGES = [
  { id: '7', label: '7 j', days: 7 },
  { id: '30', label: '30 j', days: 30 },
  { id: '90', label: '90 j', days: 90 },
  { id: '365', label: '1 an', days: 365 },
  { id: 'all', label: 'Tout', days: null },
];

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const tenths = (v) => Math.round(v * 10);

/* ---------- Dates ---------- */

// Jour « de l'appli » à l'instant donné, comme date UTC minuit.
// La journée ne bascule qu'à 4 h du matin (comme Lifestyle) : une pesée de 2 h compte pour la veille.
export function localDayKey(now = new Date(), rolloverHour = 4) {
  const t = new Date(now.getTime() - rolloverHour * 3600e3);
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 1000;
}

export function parts(d) {
  const t = new Date(d * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate(), wd: t.getUTCDay() };
}

export function dateFromParts(y, m, day) {
  return Date.UTC(y, m, day) / 1000;
}

export function fmtDate(d, withYear = false) {
  const { y, m, day, wd } = parts(d);
  return `${JOURS[wd]} ${day} ${MOIS[m]}${withYear ? ' ' + y : ''}`;
}

export function fmtDayYear(d) {
  const { y, m, day } = parts(d);
  return `${day} ${MOIS[m]} ${y}`;
}

export function fmtFull(d) {
  const { y, m, day } = parts(d);
  return `${String(day).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`;
}

export function fmtIso(d) {
  const { y, m, day } = parts(d);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = dateFromParts(+m[1], +m[2] - 1, +m[3]);
  return fmtIso(d) === s ? d : null;
}

export function monthTitle(d) {
  const { y, m } = parts(d);
  return `${MOIS_LONGS[m]} ${y}`;
}

export function relativeDay(d, today) {
  const n = Math.round((today - d) / DAY);
  if (n === 0) return 'Aujourd’hui';
  if (n === 1) return 'Hier';
  if (n === 2) return 'Avant-hier';
  if (n > 2) return `Il y a ${n} jours`;
  return fmtDate(d, true);
}

export const addDays = (d, n) => d + n * DAY;

// Ajoute des mois en gardant le même quantième (31 mars - 1 mois = 28 ou 29 février).
export function addMonths(d, n) {
  const { y, m, day } = parts(d);
  const total = m + n;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return dateFromParts(ty, tm, Math.min(day, last));
}

export const addYears = (d, n) => addMonths(d, 12 * n);

/* ---------- Nombres ---------- */

export function fmtNum(v, dec = 1) {
  if (v == null) return '—';
  return v.toFixed(dec).replace('.', ',');
}

// Saisie : « 88 », « 22,4 », « 22.4 ». Jamais de « % » ni de 0,88 : on garde le nombre tel quel.
export function parseInput(str, { min, max }) {
  const s = String(str ?? '').trim().replace(',', '.');
  if (s === '') return { empty: true };
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(s)) return { error: 'format' };
  const v = Math.round(parseFloat(s) * 10) / 10;
  if (v < min || v > max) return { error: 'plage' };
  return { value: v };
}

/* ---------- Données ---------- */

// Une mesure à 0 n'est pas une donnée (anciens jours saisis sans composition corporelle) : elle devient « vide ».
export function cleanRow(r) {
  const out = { ...r };
  for (const k of ['p', 'mg', 'mm', 'mh', 'gv']) {
    if (out[k] != null && !(out[k] > 0)) out[k] = null;
  }
  return out;
}

// Dernière valeur renseignée pour une mesure, strictement avant le jour d (rows triées par date croissante).
export function prevValue(rows, key, d) {
  let lo = 0;
  let hi = rows.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].d < d) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (; i >= 0; i--) {
    if (rows[i][key] != null) return { value: rows[i][key], d: rows[i].d };
  }
  return null;
}

// Records absolus : meilleure valeur de chaque mesure, avec la date (la plus récente si égalité) et le nombre d'égalités.
export function absoluteRecords(rows) {
  return METRICS.map((m) => {
    const vals = rows.filter((r) => r[m.key] != null);
    if (!vals.length) return { key: m.key, value: null, d: null, ties: 0 };
    const pick = m.better === 'low' ? Math.min : Math.max;
    const best = pick(...vals.map((r) => tenths(r[m.key])));
    const holders = vals.filter((r) => tenths(r[m.key]) === best);
    return { key: m.key, value: best / 10, d: holders[holders.length - 1].d, ties: holders.length - 1 };
  });
}

export function buildIndex(rows) {
  const index = new Map();
  for (const r of rows) index.set(r.d, r);
  return index;
}

// Dernière ligne dont la date est <= d (rows triées par date croissante).
export function latestOnOrBefore(rows, d) {
  let lo = 0;
  let hi = rows.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].d <= d) {
      found = rows[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// Ligne exacte, sinon la plus proche à +/- tol jours (la plus ancienne en cas d'égalité).
export function nearest(index, target, tol) {
  if (index.has(target)) return { row: index.get(target), offset: 0 };
  for (let k = 1; k <= tol; k++) {
    const before = index.get(target - k * DAY);
    if (before) return { row: before, offset: -k };
    const after = index.get(target + k * DAY);
    if (after) return { row: after, offset: k };
  }
  return null;
}

// Entrée précédente la plus proche (jusqu'à tol jours avant).
export function prevEntry(index, d, tol = 3) {
  for (let k = 1; k <= tol; k++) {
    const r = index.get(d - k * DAY);
    if (r) return r;
  }
  return null;
}

// Les n derniers jours glissants qui se terminent à D (du plus ancien au plus récent).
export function lastDays(index, D, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = D - i * DAY;
    out.push({ d, row: index.get(d) || null });
  }
  return out;
}

// Références de comparaison : même jour de la semaine d'avant, mois d'avant, puis chaque année d'avant.
export function comparisons(index, D, firstYear) {
  const refs = [
    { id: 'w', label: 'Semaine dernière', target: addDays(D, -7), tol: 2 },
    { id: 'm', label: 'Mois dernier', target: addMonths(D, -1), tol: 2 },
  ];
  const y0 = parts(D).y;
  for (let y = y0 - 1; y >= firstYear; y--) {
    refs.push({ id: 'y' + y, label: String(y), target: addYears(D, y - y0), tol: 3, year: true });
  }
  return refs.map((r) => ({ ...r, hit: nearest(index, r.target, r.tol) }));
}

// Écart courant - référence. dir = sens de la variation, tone = bon / mauvais selon la mesure.
export function delta(cur, ref, better) {
  if (cur == null || ref == null) return null;
  const diff = (tenths(cur) - tenths(ref)) / 10;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  let tone = 'flat';
  if (diff !== 0) tone = diff < 0 === (better === 'low') ? 'good' : 'bad';
  return { diff, dir, tone };
}

/* ---------- Records ---------- */

function isBestAmong(value, others, better) {
  if (!others.length) return false;
  const v = tenths(value);
  const vals = others.map(tenths);
  return better === 'low' ? v <= Math.min(...vals) : v >= Math.max(...vals);
}

// Record d'une valeur saisie à la date D, comparée aux autres jours.
//   'abs' : égale ou meilleure que toutes les autres valeurs
//   'w30' : égale ou meilleure que toutes les autres des 30 jours glissants qui finissent à refDate
export function recordFor(rows, key, better, value, date, refDate) {
  if (value == null) return null;
  const others = rows.filter((r) => r.d !== date && r[key] != null);
  if (isBestAmong(value, others.map((r) => r[key]), better)) return 'abs';
  const from = refDate - (WINDOW_DAYS - 1) * DAY;
  if (date >= from && date <= refDate) {
    const win = others.filter((r) => r.d >= from && r.d <= refDate);
    if (isBestAmong(value, win.map((r) => r[key]), better)) return 'w30';
  }
  return null;
}

// Pour l'historique : calcule une fois les meilleures valeurs, puis marque chaque ligne.
// Un record est la valeur qui détient aujourd'hui le meilleur résultat (les égalités comptent).
export function recordTable(rows, refDate) {
  const from = refDate - (WINDOW_DAYS - 1) * DAY;
  const table = {};
  for (const m of METRICS) {
    const vals = rows.filter((r) => r[m.key] != null);
    const win = vals.filter((r) => r.d >= from && r.d <= refDate);
    const pick = m.better === 'low' ? Math.min : Math.max;
    const best = (arr) => (arr.length < 2 ? null : pick(...arr.map((r) => tenths(r[m.key]))));
    table[m.key] = { abs: best(vals), win: best(win), from, to: refDate };
  }
  return table;
}

export function flagFromTable(table, metric, row) {
  const v = row[metric.key];
  if (v == null) return null;
  const t = table[metric.key];
  const x = tenths(v);
  if (t.abs !== null && x === t.abs) return 'abs';
  if (t.win !== null && row.d >= t.from && row.d <= t.to && x === t.win) return 'w30';
  return null;
}

/* ---------- Règle graduée sous le poids ---------- */

// Position de la valeur dans l'étendue des 30 derniers jours (min et max affichés aux extrémités).
export function rulerModel(rows, D, value) {
  const from = D - (WINDOW_DAYS - 1) * DAY;
  const vals = rows.filter((r) => r.d >= from && r.d <= D && r.d !== D && r.p != null).map((r) => r.p);
  if (value != null) vals.push(value);
  if (!vals.length) return null;
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  let lo = minV;
  let hi = maxV;
  if (hi - lo < 1) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const pos = value == null ? null : (value - lo) / (hi - lo);
  return { minV, maxV, pos };
}

/* ---------- Historique ---------- */

export function filterRange(rows, today, rangeId) {
  const r = RANGES.find((x) => x.id === rangeId) || RANGES[1];
  if (r.days == null) return rows;
  const from = today - (r.days - 1) * DAY;
  return rows.filter((x) => x.d >= from && x.d <= today);
}

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function searchKey(d) {
  const { y, m, day, wd } = parts(d);
  const dd = String(day).padStart(2, '0');
  const mm = String(m + 1).padStart(2, '0');
  return strip(
    [
      `${dd}/${mm}/${y}`,
      `${dd}-${mm}-${y}`,
      `${dd}.${mm}.${y}`,
      JOURS_LONGS[wd],
      `${day} ${MOIS_LONGS[m]} ${y}`,
      MOIS[m],
    ].join(' '),
  );
}

// Tous les mots tapés doivent se retrouver dans la date : « 27/10 », « oct 2025 », « lundi », « 2024 ».
export function matchSearch(d, query) {
  const tokens = strip(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const key = searchKey(d);
  return tokens.every((t) => key.includes(t));
}
