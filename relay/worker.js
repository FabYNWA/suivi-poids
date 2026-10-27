// Relais Cloudflare pour l'appli « Suivi poids ».
//
// L'appli parle à ce relais, le relais parle à Grist avec la clé API.
// La clé reste donc chez Cloudflare : elle n'est jamais sur le téléphone ni dans le code public.
//
// Réglages à créer dans Cloudflare (Settings > Variables and Secrets) :
//   Texte   GRIST_HOST      https://fabienbois.getgrist.com
//   Texte   DOC_ID          9uHXcn9oEnKmwhb5Swyz3H
//   Texte   ALLOWED_ORIGIN  https://fabynwa.github.io
//   Secret  GRIST_API_KEY   la clé API Grist
//   Secret  APP_CODE        le code d'accès que tu tapes dans l'appli

const TABLE = 'Poids';

// Clé courte utilisée par l'appli -> colonne Grist
const FIELDS = {
  p: 'Poids',
  mg: 'MasseGrasse',
  mm: 'MasseMusculaire',
  mh: 'MasseHydrique',
  gv: 'GraisseViscerale',
};

// Bornes de sécurité : le relais refuse tout ce qui sort de ces plages.
const LIMITS = {
  p: [30, 250],
  mg: [1, 70],
  mm: [10, 90],
  mh: [20, 90],
  gv: [0, 60],
};

const DAY = 86400;
const MIN_DATE = 1577836800; // 01-01-2020
const MAX_BODY = 2048;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    const origin = request.headers.get('Origin');

    // Un navigateur venant d'un autre site est refusé d'office.
    if (origin && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: 'origine_refusee', message: 'Origine non autorisée.' }, 403, {});
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/poids') {
      return json({ error: 'introuvable', message: 'Page introuvable.' }, 404, cors);
    }
    if (request.method !== 'GET' && request.method !== 'PUT') {
      return json({ error: 'methode', message: 'Méthode non autorisée.' }, 405, cors);
    }

    if (!env.GRIST_API_KEY || !env.APP_CODE || !env.DOC_ID || !env.GRIST_HOST) {
      return json({ error: 'configuration', message: 'Le relais est mal configuré.' }, 500, cors);
    }

    const given = request.headers.get('X-Code') || '';
    if (!(await sameSecret(given, env.APP_CODE))) {
      return json({ error: 'code_invalide', message: 'Code incorrect.' }, 401, cors);
    }

    try {
      return request.method === 'GET'
        ? await readAll(env, cors)
        : await upsert(request, env, cors);
    } catch (err) {
      console.error('relais', err && err.message);
      return json({ error: 'grist_indisponible', message: 'Grist ne répond pas. Réessaie dans un instant.' }, 502, cors);
    }
  },
};

async function readAll(env, cors) {
  const res = await fetch(`${recordsUrl(env)}?sort=Date`, { headers: gristHeaders(env) });
  if (!res.ok) return upstreamError(res, cors);
  const data = await res.json();

  const rows = [];
  for (const rec of data.records || []) {
    const f = rec.fields || {};
    if (!Number.isInteger(f.Date) || typeof f.Poids !== 'number') continue;
    rows.push({
      d: f.Date,
      p: num(f.Poids),
      mg: num(f.MasseGrasse),
      mm: num(f.MasseMusculaire),
      mh: num(f.MasseHydrique),
      gv: num(f.GraisseViscerale),
    });
  }
  return json({ rows, at: Date.now() }, 200, cors);
}

async function upsert(request, env, cors) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return json({ error: 'trop_gros', message: 'Requête trop volumineuse.' }, 413, cors);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'json', message: 'Requête illisible.' }, 400, cors);
  }

  const checked = validate(body);
  if (checked.error) return json({ error: 'valeur', message: checked.error }, 400, cors);
  const { row } = checked;

  const fields = {};
  for (const [key, column] of Object.entries(FIELDS)) fields[column] = row[key];

  const res = await fetch(recordsUrl(env), {
    method: 'PUT',
    headers: { ...gristHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ require: { Date: row.d }, fields }] }),
  });
  if (!res.ok) return upstreamError(res, cors);

  return json({ row }, 200, cors);
}

// Vérifie la date et chaque mesure. Retourne { row } ou { error }.
export function validate(body, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!body || typeof body !== 'object') return { error: 'Requête illisible.' };

  const d = body.d;
  if (!Number.isInteger(d) || d % DAY !== 0 || d < MIN_DATE || d > nowSeconds + 2 * DAY) {
    return { error: 'Date invalide.' };
  }

  const row = { d };
  for (const key of Object.keys(FIELDS)) {
    const v = body[key];
    if (v === null || v === undefined) {
      if (key === 'p') return { error: 'Le poids est obligatoire.' };
      row[key] = null;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `Valeur invalide (${key}).` };
    const [min, max] = LIMITS[key];
    if (v < min || v > max) return { error: `Valeur hors limites (${key}).` };
    row[key] = Math.round(v * 10) / 10;
  }
  return { row };
}

function recordsUrl(env) {
  return `${env.GRIST_HOST.replace(/\/$/, '')}/api/docs/${env.DOC_ID}/tables/${TABLE}/records`;
}

function gristHeaders(env) {
  return { Authorization: `Bearer ${env.GRIST_API_KEY}` };
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function upstreamError(res, cors) {
  console.error('grist', res.status);
  return json(
    { error: 'grist_indisponible', message: 'Grist ne répond pas. Réessaie dans un instant.', status: res.status },
    502,
    cors,
  );
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Comparaison à durée constante, pour ne pas laisser deviner le code par le temps de réponse.
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
