import * as L from './logic.js';
import { RELAY_URL } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const KEY = { code: 'sp.code', rows: 'sp.rows', at: 'sp.at', n: 'sp.n', range: 'sp.range' };
const STALE_MS = 5 * 60 * 1000; // pas de nouvel appel à Grist si les données ont moins de 5 minutes
const METRICS = L.METRICS;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible : on continue sans cache */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

const S = {
  rows: [],
  index: new Map(),
  firstYear: 0,
  recTable: null,
  today: L.localDayKey(),
  D: 0,
  view: 'saisie',
  n: store.get(KEY.n) === '10' ? 10 : 7,
  range: L.RANGES.some((r) => r.id === store.get(KEY.range)) ? store.get(KEY.range) : '30',
  q: '',
  at: Number(store.get(KEY.at)) || 0,
  loaded: false,
  syncing: false,
  saving: false,
  touched: false, // true dès que la personne a tapé dans un champ depuis le dernier chargement du jour
};
S.D = S.today;

/* ================= Données ================= */

function setRows(rows) {
  S.rows = rows.filter((r) => Number.isInteger(r.d) && typeof r.p === 'number').map(L.cleanRow).filter((r) => r.p != null).sort((a, b) => a.d - b.d);
  S.index = L.buildIndex(S.rows);
  S.firstYear = S.rows.length ? L.parts(S.rows[0].d).y : L.parts(S.today).y;
  S.recTable = L.recordTable(S.rows, S.today);
  S.loaded = true;
}

function cacheRows() {
  store.set(KEY.rows, JSON.stringify(S.rows));
  store.set(KEY.at, String(S.at));
}

class ApiError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function api(method, body) {
  const code = store.get(KEY.code);
  if (!code) throw new ApiError('auth', 'Code requis');
  let res;
  try {
    res = await fetch(`${RELAY_URL}/poids`, {
      method,
      headers: { 'X-Code': code, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network', 'Pas de connexion');
  }
  if (res.status === 401) throw new ApiError('auth', 'Code incorrect');
  let data = null;
  try { data = await res.json(); } catch { /* réponse sans contenu */ }
  if (!res.ok) throw new ApiError('server', (data && data.message) || 'Le serveur a répondu par une erreur.');
  return data;
}

async function sync({ force = false } = {}) {
  if (S.syncing) return;
  if (!store.get(KEY.code)) return showLock();
  if (!force && S.loaded && Date.now() - S.at < STALE_MS) return;
  S.syncing = true;
  $('#sync').classList.add('spin');
  try {
    const data = await api('GET');
    setRows(data.rows);
    S.at = Date.now();
    cacheRows();
    renderAll({ keepForm: S.touched });
    updateNote();
  } catch (e) {
    handleError(e, 'sync');
  } finally {
    S.syncing = false;
    $('#sync').classList.remove('spin');
  }
}

/* ================= Formulaire ================= */

const field = (key) => $('#f-' + key);

function readForm() {
  const out = {};
  for (const m of METRICS) out[m.key] = L.parseInput(field(m.key).value, m);
  return out;
}

const typedValue = (r) => (r && r.value != null ? r.value : null);

function isDirty() {
  const saved = S.index.get(S.D);
  const f = readForm();
  return METRICS.some((m) => {
    const r = f[m.key];
    if (r.error) return true;
    return typedValue(r) !== ((saved && saved[m.key]) ?? null);
  });
}

function loadForm() {
  const saved = S.index.get(S.D);
  for (const m of METRICS) field(m.key).value = saved && saved[m.key] != null ? L.fmtNum(saved[m.key]) : '';
  const before = L.latestOnOrBefore(S.rows, S.D - L.DAY);
  field('p').placeholder = before ? L.fmtNum(before.p) : '0,0';
  S.touched = false;
  clearErrors();
  showStatus('');
}

function clearErrors() {
  $$('.field.invalid, .hero.invalid').forEach((el) => el.classList.remove('invalid'));
}

function setDay(d) {
  const next = Math.min(d, S.today);
  if (next === S.D) return;
  if (S.touched && isDirty() && !confirm('Abandonner la saisie en cours ?')) return;
  S.D = next;
  loadForm();
  renderAll();
}

function step(delta) {
  S.touched = true;
  const r = L.parseInput(field('p').value, METRICS[0]);
  let base = r.value;
  if (base == null) {
    const before = L.latestOnOrBefore(S.rows, S.D);
    base = before ? before.p : 85;
  }
  const v = Math.min(METRICS[0].max, Math.max(METRICS[0].min, Math.round((base + delta) * 10) / 10));
  field('p').value = L.fmtNum(v);
  renderLive();
}

const LIMIT_TEXT = {
  p: 'Le poids doit être compris entre 30 et 250 kg.',
  mg: 'La masse grasse doit être comprise entre 1 et 70.',
  mm: 'La masse musculaire doit être comprise entre 10 et 90.',
  mh: 'La masse hydrique doit être comprise entre 20 et 90.',
  gv: 'La graisse viscérale doit être comprise entre 0 et 60.',
};

async function save() {
  if (S.saving) return;
  const f = readForm();
  clearErrors();

  for (const m of METRICS) {
    const r = f[m.key];
    const wrap = m.key === 'p' ? $('.hero') : field(m.key).closest('.field');
    if (m.key === 'p' && r.empty) {
      wrap.classList.add('invalid');
      field('p').focus();
      return showStatus('Saisis le poids pour enregistrer.', 'error');
    }
    if (r.error) {
      wrap.classList.add('invalid');
      field(m.key).focus();
      const typed = parseFloat(field(m.key).value.replace(',', '.'));
      if (r.error === 'plage' && m.unit === '%' && typed > 0 && typed < 1) {
        return showStatus('Tape le pourcentage tel quel : 88 pour 88 %, pas 0,88.', 'error');
      }
      return showStatus(r.error === 'format' ? 'Tape un nombre, par exemple 22,4. Pas besoin du signe %.' : LIMIT_TEXT[m.key], 'error');
    }
  }

  const body = { d: S.D };
  for (const m of METRICS) body[m.key] = typedValue(f[m.key]);

  S.saving = true;
  updateSaveButton();
  try {
    const data = await api('PUT', body);
    const rows = S.rows.filter((r) => r.d !== data.row.d);
    rows.push(data.row);
    setRows(rows);
    cacheRows();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    S.touched = false;
    renderAll({ keepForm: true });
    showStatus(`Enregistré à ${clock(new Date())}.`, 'ok');
    toast('Enregistré');
  } catch (e) {
    handleError(e, 'save');
  } finally {
    S.saving = false;
    updateSaveButton();
  }
}

/* ================= Rendu : écran Saisie ================= */

const ARROW = (dir) => `<svg class="ar ${dir}" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 1.2 7.4 6.8H.6z"/></svg>`;

function deltaHTML(dl) {
  if (!dl) return '';
  if (dl.dir === 'flat') return '<span class="d flat" aria-label="inchangé">=</span>';
  const txt = L.fmtNum(Math.abs(dl.diff));
  const word = dl.dir === 'down' ? 'baisse' : 'hausse';
  return `<span class="d ${dl.tone}" aria-label="${word} de ${txt}">${ARROW(dl.dir)}${txt}</span>`;
}

function pillHTML(flag) {
  if (flag === 'abs') return '<span class="pill abs">Record absolu</span>';
  if (flag === 'w30') return '<span class="pill w30">Record 30 j</span>';
  return '';
}

/* Un record se voit sur le chiffre lui-même (fond plein ou contour) : la mise en page ne bouge jamais. */
function valueHTML(text, flag) {
  if (!flag) return `<span class="v">${text}</span>`;
  const label = flag === 'abs' ? 'record absolu' : 'record sur 30 jours';
  return `<span class="v ${flag}"><span class="sr">${label} : </span>${text}</span>`;
}

function renderDayBar() {
  const showYear = L.parts(S.D).y !== L.parts(S.today).y;
  $('#dayText').textContent = L.fmtDate(S.D, showYear);
  $('#dayRel').textContent = L.relativeDay(S.D, S.today);
  $('#dayPicker').value = L.fmtIso(S.D);
  $('#dayPicker').max = L.fmtIso(S.today);
  $('#next').disabled = S.D >= S.today;
}

function updatePills() {
  const f = readForm();
  for (const m of METRICS) {
    const v = typedValue(f[m.key]);
    const flag = v != null ? L.recordFor(S.rows, m.key, m.better, v, S.D, S.D) : null;
    const prev = v != null ? L.prevValue(S.rows, m.key, S.D) : null;
    const dl = prev ? L.delta(v, prev.value, m.better) : null;
    $('#pill-' + m.key).innerHTML = deltaHTML(dl) + pillHTML(flag);
  }
}

function updateRuler() {
  const v = typedValue(readForm().p);
  const model = L.rulerModel(S.rows, S.D, v);
  const el = $('#ruler');
  el.classList.toggle('off', !model);
  if (!model) return;
  el.classList.toggle('nomark', model.pos == null);
  if (model.pos != null) el.style.setProperty('--pos', (Math.min(1, Math.max(0, model.pos)) * 100).toFixed(1) + '%');
  $('#rMin').textContent = L.fmtNum(model.minV);
  $('#rMax').textContent = L.fmtNum(model.maxV);
  el.setAttribute('aria-label', `Poids parmi les 30 derniers jours, entre ${L.fmtNum(model.minV)} et ${L.fmtNum(model.maxV)} kg`);
}

function updateSaveButton() {
  const btn = $('#save');
  const dirty = isDirty();
  btn.disabled = S.saving || !dirty;
  btn.textContent = S.saving ? 'Enregistrement…' : 'Enregistrer';
}

function renderRecent() {
  const table = $('#recent');
  $('#recentTitle').textContent = `${S.n} derniers jours`;
  $$('#nSeg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === S.n)));

  const head = `<thead><tr><th scope="col">Jour</th>${METRICS.map((m) => `<th scope="col" class="m-${m.key}">${m.short}</th>`).join('')}</tr></thead>`;
  if (!S.loaded) {
    table.innerHTML = head + `<tbody><tr><td class="none" colspan="${METRICS.length + 1}">Chargement…</td></tr></tbody>`;
    return;
  }
  const days = L.lastDays(S.index, S.D, S.n).reverse();
  const body = days.map(({ d, row }, i) => {
    const sel = i === 0 ? ' sel' : '';
    if (!row) return `<tr class="${sel.trim()}"><th scope="row">${L.fmtDate(d)}</th><td class="none" colspan="${METRICS.length}">Pas de saisie</td></tr>`;
    return `<tr class="row${sel}" data-d="${d}" tabindex="0"><th scope="row">${L.fmtDate(d)}</th>${METRICS.map((m) => metricCell(m, row)).join('')}</tr>`;
  });
  table.innerHTML = head + `<tbody>${body.join('')}</tbody>`;
}

function metricCell(m, row) {
  const v = row[m.key];
  if (v == null) return '<td class="dim">—</td>';
  const flag = L.flagFromTable(S.recTable, m, row);
  if (m.key === 'p') {
    const prev = L.prevValue(S.rows, 'p', row.d);
    const dl = prev ? L.delta(row.p, prev.value, m.better) : null;
    return `<td><span class="cell-stack">${valueHTML(L.fmtNum(v), flag)}${deltaHTML(dl)}</span></td>`;
  }
  return `<td>${valueHTML(L.fmtNum(v), flag)}</td>`;
}

function renderCompare() {
  const list = $('#cmp');
  if (!S.loaded) {
    list.innerHTML = '<li class="cmp empty"><span class="cmp-name">Chargement…</span></li>';
    return;
  }
  const f = readForm();
  const cur = {};
  for (const m of METRICS) cur[m.key] = typedValue(f[m.key]);

  list.innerHTML = L.comparisons(S.index, S.D, S.firstYear)
    .map((ref) => {
      if (!ref.hit) {
        return `<li class="cmp empty"><span class="cmp-name">${ref.label}</span><span class="cmp-date">${L.fmtDate(ref.target, ref.year)} : pas de saisie</span></li>`;
      }
      const { row, offset } = ref.hit;
      const near = offset === 0 ? '' : `<em>à ${Math.abs(offset)} j près</em>`;
      const dp = L.delta(cur.p, row.p, 'low');
      const chips = METRICS.slice(1)
        .map((m) => {
          const dl = L.delta(cur[m.key], row[m.key], m.better);
          return dl ? `<span class="chip">${m.short} ${L.fmtNum(row[m.key])} ${deltaHTML(dl)}</span>` : '';
        })
        .join('');
      return `<li class="cmp"><span class="cmp-name">${ref.label}</span>
        <span class="cmp-date">${L.fmtDate(row.d, ref.year)}${near}</span>
        <span class="cmp-val"><b>${L.fmtNum(row.p)}<small>kg</small></b>${deltaHTML(dp)}</span>
        ${chips ? `<span class="cmp-sub">${chips}</span>` : ''}</li>`;
    })
    .join('');
}

function renderLive() {
  clearErrors();
  if ($('#status').classList.contains('error')) showStatus('');
  updatePills();
  updateRuler();
  renderCompare();
  updateSaveButton();
}

function renderAll({ keepForm = false } = {}) {
  renderDayBar();
  if (!keepForm) loadForm();
  renderRecent();
  renderLive();
  if (S.view === 'histo') renderHisto();
}

/* ================= Rendu : écran Historique ================= */

function renderRecords(hidden) {
  const box = $('#records');
  box.hidden = hidden || !S.loaded;
  if (box.hidden) return;
  const list = L.absoluteRecords(S.rows).map((r) => {
    const m = METRICS.find((x) => x.key === r.key);
    const val = r.value == null ? '—' : `${L.fmtNum(r.value)}${m.unit ? ' ' + m.unit : ''}`;
    const date = r.d == null ? '' : `<button type="button" class="rec-date" data-d="${r.d}">${L.fmtDayYear(r.d)}</button>`;
    const ties = r.ties ? `<small>+ ${r.ties} égalité${r.ties > 1 ? 's' : ''}</small>` : '';
    return `<li><span class="rec-name m-${m.key}">${m.label}</span><b class="v abs">${val}</b><span class="rec-when">${date}${ties}</span></li>`;
  });
  box.innerHTML = `<h2>Records absolus</h2><ul>${list.join('')}</ul>`;
}

function renderHisto() {
  const seg = $('#rangeSeg');
  if (!seg.children.length) {
    seg.innerHTML = L.RANGES.map((r) => `<button type="button" data-r="${r.id}" aria-pressed="false">${r.label}</button>`).join('');
  }
  const searching = S.q.trim() !== '';
  seg.classList.toggle('muted', searching);
  $$('#rangeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.r === S.range)));

  const rows = (searching ? S.rows.filter((r) => L.matchSearch(r.d, S.q)) : L.filterRange(S.rows, S.today, S.range)).slice().reverse();
  const n = rows.length;
  $('#count').textContent = searching
    ? `${n} résultat${n > 1 ? 's' : ''} dans tout l’historique`
    : `${n} jour${n > 1 ? 's' : ''} saisi${n > 1 ? 's' : ''}`;

  renderRecords(searching);
  const head = `<thead><tr><th scope="col">Jour</th>${METRICS.map((m) => `<th scope="col" class="m-${m.key}">${m.short}</th>`).join('')}</tr></thead>`;
  if (!S.loaded) {
    $('#histo').innerHTML = head + `<tbody><tr><td class="none" colspan="${METRICS.length + 1}">Chargement…</td></tr></tbody>`;
    return;
  }
  if (!n) {
    $('#histo').innerHTML = head + `<tbody><tr><td class="none" colspan="${METRICS.length + 1}">${searching ? 'Aucune saisie pour cette date.' : 'Aucune saisie sur cette période.'}</td></tr></tbody>`;
    return;
  }

  const withMonths = rows[0].d - rows[n - 1].d > 35 * L.DAY;
  let lastMonth = '';
  const body = [];
  for (const row of rows) {
    if (withMonths) {
      const title = L.monthTitle(row.d);
      if (title !== lastMonth) {
        body.push(`<tr class="month"><th colspan="${METRICS.length + 1}" scope="colgroup">${title}</th></tr>`);
        lastMonth = title;
      }
    }
    const sel = row.d === S.D ? ' sel' : '';
    body.push(`<tr class="row${sel}" data-d="${row.d}" tabindex="0"><th scope="row">${L.fmtDate(row.d, !withMonths && L.parts(row.d).y !== L.parts(S.today).y)}</th>${METRICS.map((m) => metricCell(m, row)).join('')}</tr>`);
  }
  $('#histo').innerHTML = head + `<tbody>${body.join('')}</tbody>`;
}

/* ================= Navigation, messages, verrou ================= */

function switchView(view) {
  S.view = view;
  $('#view-saisie').hidden = view !== 'saisie';
  $('#view-histo').hidden = view !== 'histo';
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  if (view === 'histo') {
    renderHisto();
    const scroller = $('.tablescroll');
    if (scroller) scroller.scrollTop = 0;
  } else {
    $('#view-saisie').scrollTop = 0;
  }
}

function openDay(d) {
  S.D = d;
  loadForm();
  renderAll();
  switchView('saisie');
}

function showStatus(msg, kind = '') {
  const el = $('#status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

const clock = (date) => date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function updateNote(extra = '') {
  const el = $('#syncNote');
  if (!S.at) { el.textContent = extra; return; }
  const when = new Date(S.at);
  const sameDay = L.localDayKey(when, 0) === L.localDayKey(new Date(), 0);
  const stamp = sameDay ? `à ${clock(when)}` : `le ${L.fmtDate(L.localDayKey(when, 0))} à ${clock(when)}`;
  el.textContent = `${extra ? extra + ' ' : ''}Données ${stamp}.`;
}

function handleError(e, ctx) {
  if (e.kind === 'auth') {
    store.del(KEY.code);
    showLock('Code incorrect. Réessaie.');
    return;
  }
  if (ctx === 'save') {
    showStatus(e.kind === 'network' ? 'Pas de connexion. Ta saisie est conservée : réessaie dans un instant.' : `${e.message} Ta saisie est conservée.`, 'error');
  } else {
    updateNote(e.kind === 'network' ? 'Hors connexion.' : 'Synchronisation impossible.');
  }
}

function showLock(msg) {
  const p = $('#lockMsg');
  p.textContent = msg || 'Entre ton code d’accès.';
  p.classList.toggle('error', Boolean(msg));
  $('#lock').hidden = false;
  $('#code').value = '';
  setTimeout(() => $('#code').focus(), 50);
}

/* ================= Démarrage ================= */

function bind() {
  $('#prev').addEventListener('click', () => setDay(L.addDays(S.D, -1)));
  $('#next').addEventListener('click', () => setDay(L.addDays(S.D, 1)));
  $('#dayPicker').addEventListener('change', (e) => {
    const d = L.parseIso(e.target.value);
    if (d != null) setDay(d);
    else e.target.value = L.fmtIso(S.D);
  });
  $('#sync').addEventListener('click', () => sync({ force: true }));
  $('#pm').addEventListener('click', () => step(-0.1));
  $('#pp').addEventListener('click', () => step(0.1));
  $('#save').addEventListener('click', save);

  METRICS.forEach((m, i) => {
    const el = field(m.key);
    el.addEventListener('input', () => {
      S.touched = true;
      const clean = el.value.replace(/[^\d.,]/g, '');
      if (clean !== el.value) el.value = clean;
      renderLive();
    });
    el.addEventListener('focus', () => el.select && el.select());
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = METRICS[i + 1];
      if (next) field(next.key).focus();
      else { el.blur(); save(); }
    });
  });

  $('#nSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    S.n = Number(b.dataset.n);
    store.set(KEY.n, String(S.n));
    renderRecent();
  });

  $('#rangeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-r]');
    if (!b) return;
    S.range = b.dataset.r;
    S.q = '';
    $('#q').value = '';
    store.set(KEY.range, S.range);
    renderHisto();
    $('.tablescroll').scrollTop = 0;
  });

  $('#q').addEventListener('input', (e) => {
    S.q = e.target.value;
    renderHisto();
    $('.tablescroll').scrollTop = 0;
  });
  $('#jump').addEventListener('change', (e) => {
    const d = L.parseIso(e.target.value);
    e.target.value = '';
    if (d == null) return;
    S.q = L.fmtFull(d);
    $('#q').value = S.q;
    renderHisto();
  });

  const openFromRow = (e) => {
    const tr = e.target.closest('tr[data-d]');
    if (tr) openDay(Number(tr.dataset.d));
  };
  for (const id of ['#recent', '#histo']) {
    $(id).addEventListener('click', openFromRow);
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') openFromRow(e); });
  }

  $('#records').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]');
    if (b) openDay(Number(b.dataset.d));
  });

  $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  $('#lockBtn').addEventListener('click', () => {
    store.del(KEY.code);
    store.del(KEY.rows);
    store.del(KEY.at);
    S.rows = []; S.index = new Map(); S.loaded = false; S.at = 0;
    renderAll();
    showLock();
  });
  $('#lockForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#code').value.trim();
    if (!code) return;
    store.set(KEY.code, code);
    $('#lock').hidden = true;
    sync({ force: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const t = L.localDayKey();
    if (t !== S.today) {
      const wasToday = S.D === S.today;
      S.today = t;
      if (wasToday) S.D = t;
      if (S.loaded) setRows(S.rows);
      renderAll({ keepForm: !wasToday && S.touched });
    }
    sync();
  });
}

function init() {
  try {
    const cached = JSON.parse(store.get(KEY.rows) || 'null');
    if (Array.isArray(cached) && cached.length) setRows(cached);
  } catch { /* cache illisible : on repart de zéro */ }

  bind();
  renderAll();
  updateNote();

  if (!store.get(KEY.code)) showLock();
  else sync();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
