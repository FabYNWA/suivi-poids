import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

const D = (y, m, d) => Date.UTC(y, m - 1, d) / 1000; // m = 1..12
const row = (y, m, d, p, extra = {}) => ({ d: D(y, m, d), p, mg: null, mm: null, mh: null, gv: null, ...extra });

/* ---------- Dates ---------- */

test('jour de l’appli : la journée bascule à 4 h', () => {
  assert.equal(L.localDayKey(new Date(2026, 9, 27, 11, 42)), D(2026, 10, 27));
  assert.equal(L.localDayKey(new Date(2026, 9, 28, 2, 50)), D(2026, 10, 27)); // 2 h 50 -> encore la veille
  assert.equal(L.localDayKey(new Date(2026, 9, 28, 4, 0)), D(2026, 10, 28));
  assert.equal(L.localDayKey(new Date(2026, 0, 1, 1, 0)), D(2025, 12, 31)); // changement d'année
});

test('mois d’avant : le quantième est ramené à la fin du mois si besoin', () => {
  assert.equal(L.addMonths(D(2026, 10, 27), -1), D(2026, 9, 27));
  assert.equal(L.addMonths(D(2026, 3, 31), -1), D(2026, 2, 28));
  assert.equal(L.addMonths(D(2024, 3, 31), -1), D(2024, 2, 29));
  assert.equal(L.addMonths(D(2026, 1, 15), -1), D(2025, 12, 15));
  assert.equal(L.addMonths(D(2026, 12, 31), 2), D(2027, 2, 28));
});

test('année d’avant : le 29 février devient le 28', () => {
  assert.equal(L.addYears(D(2024, 2, 29), -1), D(2023, 2, 28));
  assert.equal(L.addYears(D(2026, 10, 27), -4), D(2022, 10, 27));
});

test('formats de date en français', () => {
  assert.equal(L.fmtDate(D(2026, 10, 27)), 'mar. 27 oct.');
  assert.equal(L.fmtDate(D(2025, 2, 3), true), 'lun. 3 févr. 2025');
  assert.equal(L.fmtFull(D(2026, 1, 5)), '05/01/2026');
  assert.equal(L.monthTitle(D(2026, 8, 12)), 'août 2026');
  assert.equal(L.fmtIso(D(2026, 10, 7)), '2026-10-07');
  assert.equal(L.parseIso('2026-10-07'), D(2026, 10, 7));
  assert.equal(L.parseIso('2026-02-30'), null);
  assert.equal(L.parseIso('nimportequoi'), null);
});

test('libellé relatif du jour', () => {
  const t = D(2026, 10, 27);
  assert.equal(L.relativeDay(t, t), 'Aujourd’hui');
  assert.equal(L.relativeDay(D(2026, 10, 26), t), 'Hier');
  assert.equal(L.relativeDay(D(2026, 10, 25), t), 'Avant-hier');
  assert.equal(L.relativeDay(D(2026, 10, 21), t), 'Il y a 6 jours');
});

/* ---------- Saisie ---------- */

test('saisie : « 88 », « 22,4 » et « 22.4 » sont lus tels quels, jamais en 0,88', () => {
  const mg = { min: 1, max: 70 };
  assert.deepEqual(L.parseInput('22,4', mg), { value: 22.4 });
  assert.deepEqual(L.parseInput('22.4', mg), { value: 22.4 });
  assert.deepEqual(L.parseInput(' 22 ', mg), { value: 22 });
  assert.deepEqual(L.parseInput('88', { min: 20, max: 90 }), { value: 88 });
  assert.deepEqual(L.parseInput('22,45', mg), { value: 22.5 }); // arrondi à 1 décimale
  assert.deepEqual(L.parseInput('', mg), { empty: true });
  assert.deepEqual(L.parseInput(null, mg), { empty: true });
  assert.equal(L.parseInput('22%', mg).error, 'format');
  assert.equal(L.parseInput('0,88', mg).error, 'plage'); // 0,9 < min : refusé plutôt que mal compris
  assert.equal(L.parseInput('abc', mg).error, 'format');
  assert.equal(L.parseInput('-3', mg).error, 'format');
  assert.equal(L.parseInput('120', mg).error, 'plage');
});

test('affichage des nombres avec la virgule', () => {
  assert.equal(L.fmtNum(86.4), '86,4');
  assert.equal(L.fmtNum(86), '86,0');
  assert.equal(L.fmtNum(null), '—');
});

/* ---------- Comparatifs ---------- */

const data = [
  row(2022, 10, 27, 96.0),
  row(2023, 10, 26, 87.0), // décalé d'un jour
  row(2024, 10, 27, 88.0),
  // 2025 : rien autour du 27/10
  row(2026, 9, 26, 86.8), // mois dernier, décalé d'un jour
  row(2026, 10, 19, 86.1), // semaine dernière, décalé d'un jour
  row(2026, 10, 20, 86.5),
  row(2026, 10, 27, 86.9),
];
const index = L.buildIndex(data);

test('comparatifs : semaine, mois puis chaque année, avec décalage signalé', () => {
  const refs = L.comparisons(index, D(2026, 10, 27), 2022);
  assert.deepEqual(refs.map((r) => r.label), ['Semaine dernière', 'Mois dernier', '2025', '2024', '2023', '2022']);

  const [w, m, y25, y24, y23, y22] = refs;
  assert.equal(w.target, D(2026, 10, 20));
  assert.equal(w.hit.row.p, 86.5);
  assert.equal(w.hit.offset, 0);

  assert.equal(m.target, D(2026, 9, 27));
  assert.equal(m.hit.row.p, 86.8);
  assert.equal(m.hit.offset, -1);

  assert.equal(y25.hit, null); // pas de saisie : la ligne s'affiche vide
  assert.equal(y24.hit.row.p, 88);
  assert.equal(y23.hit.row.p, 87);
  assert.equal(y23.hit.offset, -1);
  assert.equal(y22.hit.row.p, 96);
});

test('comparatifs : tolérance de 2 jours (semaine, mois) et 3 jours (années)', () => {
  const idx = L.buildIndex([row(2026, 10, 17, 86), row(2025, 10, 24, 87), row(2023, 10, 30, 90)]);
  const refs = L.comparisons(idx, D(2026, 10, 27), 2023);
  assert.equal(refs[0].hit, null); // le 20/10 est à 3 jours du 17/10
  assert.equal(refs.find((r) => r.id === 'y2025').hit.row.p, 87); // 3 jours d'écart accepté
  assert.equal(refs.find((r) => r.id === 'y2023').hit.offset, 3);
});

test('comparatifs depuis un jour passé : tout est relatif au jour affiché', () => {
  const refs = L.comparisons(index, D(2024, 10, 27), 2022);
  assert.deepEqual(refs.map((r) => r.label), ['Semaine dernière', 'Mois dernier', '2023', '2022']);
});

test('écart : le sens et la couleur dépendent de la mesure', () => {
  assert.deepEqual(L.delta(86.5, 86.9, 'low'), { diff: -0.4, dir: 'down', tone: 'good' });
  assert.deepEqual(L.delta(87.1, 86.9, 'low'), { diff: 0.2, dir: 'up', tone: 'bad' });
  assert.deepEqual(L.delta(73.8, 73.5, 'high'), { diff: 0.3, dir: 'up', tone: 'good' });
  assert.deepEqual(L.delta(54.3, 54.9, 'high'), { diff: -0.6, dir: 'down', tone: 'bad' });
  assert.deepEqual(L.delta(86.9, 86.9, 'low'), { diff: 0, dir: 'flat', tone: 'flat' });
  assert.equal(L.delta(null, 86, 'low'), null);
  assert.equal(L.delta(86, null, 'low'), null);
  // pas de bruit de virgule flottante
  assert.equal(L.delta(86.3, 86.2, 'low').diff, 0.1);
});

test('7 derniers jours glissants, trous compris', () => {
  const days = L.lastDays(index, D(2026, 10, 27), 7);
  assert.equal(days.length, 7);
  assert.equal(days[0].d, D(2026, 10, 21));
  assert.equal(days[6].d, D(2026, 10, 27));
  assert.equal(days[6].row.p, 86.9);
  assert.equal(days[0].row, null);
  assert.equal(L.lastDays(index, D(2026, 10, 27), 10).length, 10);
});

test('entrée précédente : cherche jusqu’à 3 jours avant', () => {
  assert.equal(L.prevEntry(index, D(2026, 10, 27), 3), null); // 20/10 est à 7 jours
  assert.equal(L.prevEntry(index, D(2026, 10, 21), 3).p, 86.5);
  assert.equal(L.prevEntry(index, D(2026, 10, 22), 3).p, 86.5);
});

test('dernière valeur connue avant une date (recherche dichotomique)', () => {
  const sorted = [...data].sort((a, b) => a.d - b.d);
  assert.equal(L.latestOnOrBefore(sorted, D(2026, 10, 27)).p, 86.9);
  assert.equal(L.latestOnOrBefore(sorted, D(2026, 10, 25)).p, 86.5);
  assert.equal(L.latestOnOrBefore(sorted, D(2021, 1, 1)), null);
});

/* ---------- Records ---------- */

// Poids : plus bas = mieux. Masse musculaire : plus haut = mieux.
const hist = [
  row(2026, 8, 1, 88.0, { mm: 70 }),
  row(2026, 9, 1, 85.0, { mm: 72 }), // plus bas poids de tous les temps
  row(2026, 10, 1, 86.0, { mm: 71 }),
  row(2026, 10, 10, 86.4, { mm: 73 }),
  row(2026, 10, 20, 86.8, { mm: 71.5 }),
];
const today = D(2026, 10, 27);

test('record d’une valeur saisie : absolu, 30 jours, ou rien', () => {
  // 84,9 bat tout l'historique
  assert.equal(L.recordFor(hist, 'p', 'low', 84.9, D(2026, 10, 27), today), 'abs');
  // égalité avec le meilleur : compte comme record
  assert.equal(L.recordFor(hist, 'p', 'low', 85.0, D(2026, 10, 27), today), 'abs');
  // 85,9 : meilleur que tout le mois, mais pas que 85,0 de septembre (hors des 30 jours)
  assert.equal(L.recordFor(hist, 'p', 'low', 85.9, D(2026, 10, 27), today), 'w30');
  // 86,2 : bat 86,4 et 86,8 mais pas 86,0
  assert.equal(L.recordFor(hist, 'p', 'low', 86.2, D(2026, 10, 27), today), null);
  // sens inversé pour la masse musculaire
  assert.equal(L.recordFor(hist, 'mm', 'high', 74, D(2026, 10, 27), today), 'abs');
  assert.equal(L.recordFor(hist, 'mm', 'high', 73, D(2026, 10, 27), today), 'abs'); // égalité
  assert.equal(L.recordFor(hist, 'mm', 'high', 72.5, D(2026, 10, 27), today), null); // 73 le 10/10 fait mieux
  assert.equal(L.recordFor(hist, 'mm', 'high', 70.5, D(2026, 10, 27), today), null);
  // 30 jours : un record absolu ancien (hors fenêtre) laisse la place à un record du mois
  const old = [row(2026, 1, 5, 80, { mm: 80 }), row(2026, 10, 10, 86, { mm: 70 })];
  assert.equal(L.recordFor(old, 'mm', 'high', 71, D(2026, 10, 27), today), 'w30');
  assert.equal(L.recordFor(hist, 'p', 'low', null, D(2026, 10, 27), today), null);
});

test('record : la valeur déjà enregistrée ce jour-là ne se compare pas à elle-même', () => {
  // le 10/10 vaut 86,4 : sans cette règle, il bloquerait tout nouveau record du même jour
  assert.equal(L.recordFor(hist, 'p', 'low', 85.5, D(2026, 10, 10), D(2026, 10, 10)), 'w30');
});

test('record : rien à comparer = pas de record', () => {
  assert.equal(L.recordFor([], 'p', 'low', 80, today, today), null);
  assert.equal(L.recordFor([row(2026, 10, 27, 80)], 'p', 'low', 80, today, today), null);
});

test('historique : seules les valeurs qui détiennent le record sont marquées', () => {
  const table = L.recordTable(hist, today);
  const flag = (m, r) => L.flagFromTable(table, L.METRICS.find((x) => x.key === m), r);
  assert.equal(flag('p', hist[1]), 'abs'); // 85,0 : meilleur poids de tous les temps
  assert.equal(flag('p', hist[2]), 'w30'); // 86,0 : meilleur des 30 derniers jours
  assert.equal(flag('p', hist[0]), null);
  assert.equal(flag('p', hist[3]), null);
  assert.equal(flag('mm', hist[3]), 'abs'); // 73 : plus haute masse musculaire
  assert.equal(flag('mm', hist[1]), null); // 72 : hors des 30 jours et pas record
  assert.equal(flag('gv', hist[3]), null); // aucune valeur : pas de marque
});

test('historique : un record à égalité est marqué sur chaque jour concerné', () => {
  const ties = [row(2026, 10, 1, 86.0), row(2026, 10, 2, 86.0), row(2026, 10, 3, 87.0)];
  const table = L.recordTable(ties, today);
  const p = L.METRICS[0];
  assert.equal(L.flagFromTable(table, p, ties[0]), 'abs');
  assert.equal(L.flagFromTable(table, p, ties[1]), 'abs');
  assert.equal(L.flagFromTable(table, p, ties[2]), null);
});

/* ---------- Règle graduée ---------- */

test('règle : position dans l’étendue des 30 derniers jours', () => {
  const m = L.rulerModel(hist, D(2026, 10, 27), 86.4);
  assert.equal(m.minV, 86.0); // septembre (85,0) est hors fenêtre
  assert.equal(m.maxV, 86.8);
  assert.ok(m.pos > 0 && m.pos < 1);

  const low = L.rulerModel(hist, D(2026, 10, 27), 85.5);
  assert.equal(low.minV, 85.5);
  assert.ok(low.pos > 0 && low.pos < 0.2);

  assert.equal(L.rulerModel(hist, D(2026, 10, 27), null).pos, null);
  assert.equal(L.rulerModel([], D(2026, 10, 27), null), null);
  // une seule valeur : pas de division par zéro
  const one = L.rulerModel([], D(2026, 10, 27), 86);
  assert.ok(Number.isFinite(one.pos));
});

/* ---------- Historique ---------- */

test('périodes : 7 j, 30 j, 90 j, 1 an, Tout', () => {
  const rows = [];
  for (let i = 0; i < 400; i++) rows.push({ d: today - i * L.DAY, p: 86 });
  rows.reverse();
  assert.equal(L.filterRange(rows, today, '7').length, 7);
  assert.equal(L.filterRange(rows, today, '30').length, 30);
  assert.equal(L.filterRange(rows, today, '90').length, 90);
  assert.equal(L.filterRange(rows, today, '365').length, 365);
  assert.equal(L.filterRange(rows, today, 'all').length, 400);
  assert.equal(L.filterRange(rows, today, 'inconnu').length, 30);
});

test('recherche par date, façon Ctrl+F', () => {
  const d = D(2025, 10, 27); // lundi
  assert.ok(L.matchSearch(d, '27/10'));
  assert.ok(L.matchSearch(d, '27/10/2025'));
  assert.ok(L.matchSearch(d, '27-10-2025'));
  assert.ok(L.matchSearch(d, 'oct 2025'));
  assert.ok(L.matchSearch(d, 'octobre'));
  assert.ok(L.matchSearch(d, 'LUNDI'));
  assert.ok(L.matchSearch(d, '2025'));
  assert.ok(L.matchSearch(d, '  '));
  assert.ok(!L.matchSearch(d, '27/11'));
  assert.ok(!L.matchSearch(d, '2024'));
  assert.ok(!L.matchSearch(d, 'oct 2024'));
  // accents ignorés : « fevrier » trouve février
  assert.ok(L.matchSearch(D(2026, 2, 3), 'fevrier'));
  assert.ok(L.matchSearch(D(2026, 2, 3), 'févr'));
  assert.ok(L.matchSearch(D(2026, 8, 3), 'aout'));
});
