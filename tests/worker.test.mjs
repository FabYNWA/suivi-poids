import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validate } from '../relay/worker.js';

const env = {
  GRIST_HOST: 'https://fabienbois.getgrist.com/',
  DOC_ID: 'DOC123',
  ALLOWED_ORIGIN: 'https://fabynwa.github.io',
  GRIST_API_KEY: 'cle-secrete',
  APP_CODE: 'mot de passe long',
};
const ORIGIN = 'https://fabynwa.github.io';
const D = Date.UTC(2026, 9, 27) / 1000;

function call(method, { path = '/poids', code = env.APP_CODE, origin = ORIGIN, body } = {}) {
  const headers = {};
  if (code !== null) headers['X-Code'] = code;
  if (origin) headers['Origin'] = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return worker.fetch(
    new Request('https://relais.test' + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  );
}

function mockGrist(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return calls;
}

const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('refuse sans code et avec un mauvais code', async () => {
  mockGrist(() => ok({ records: [] }));
  assert.equal((await call('GET', { code: null })).status, 401);
  assert.equal((await call('GET', { code: 'faux' })).status, 401);
  assert.equal((await call('PUT', { code: '', body: { d: D, p: 86 } })).status, 401);
});

test("refuse une autre origine, sans jamais appeler Grist", async () => {
  const calls = mockGrist(() => ok({ records: [] }));
  const res = await call('GET', { origin: 'https://autre-site.example' });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(calls.length, 0);
});

test('préflight CORS accepté pour le bon site', async () => {
  const res = await call('OPTIONS', { code: null });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /X-Code/);
});

test('seul /poids existe, et seulement GET et PUT', async () => {
  mockGrist(() => ok({ records: [] }));
  assert.equal((await call('GET', { path: '/' })).status, 404);
  assert.equal((await call('GET', { path: '/poids/../autre' })).status, 404);
  assert.equal((await call('DELETE')).status, 405);
  assert.equal((await call('POST', { body: {} })).status, 405);
});

test('lecture : appelle la bonne table avec la clé et renvoie des lignes compactes', async () => {
  const calls = mockGrist(() =>
    ok({
      records: [
        { id: 1, fields: { Date: D - 86400, Poids: 86.6, MasseGrasse: null, MasseMusculaire: null, MasseHydrique: null, GraisseViscerale: null } },
        { id: 2, fields: { Date: D, Poids: 87.6, MasseGrasse: 22.4, MasseMusculaire: 73.7, MasseHydrique: 55.7, GraisseViscerale: 3.1 } },
        { id: 3, fields: { Date: null, Poids: 80 } }, // ligne incomplète : ignorée
        { id: 4, fields: { Date: D + 86400, Poids: null } }, // sans poids : ignorée
      ],
    }),
  );
  const res = await call('GET');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://fabienbois.getgrist.com/api/docs/DOC123/tables/Poids/records?sort=Date');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer cle-secrete');

  const data = await res.json();
  assert.equal(data.rows.length, 2);
  assert.deepEqual(data.rows[0], { d: D - 86400, p: 86.6, mg: null, mm: null, mh: null, gv: null });
  assert.deepEqual(data.rows[1], { d: D, p: 87.6, mg: 22.4, mm: 73.7, mh: 55.7, gv: 3.1 });
});

test('écriture : envoie un upsert sur la date, uniquement sur la table Poids', async () => {
  const calls = mockGrist(() => ok({ records: [{ id: 9 }] }));
  const res = await call('PUT', { body: { d: D, p: 86.44, mg: 22.4, mm: 73.7, mh: null, gv: 3.1 } });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].url, 'https://fabienbois.getgrist.com/api/docs/DOC123/tables/Poids/records');
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent, {
    records: [
      {
        require: { Date: D },
        fields: { Poids: 86.4, MasseGrasse: 22.4, MasseMusculaire: 73.7, MasseHydrique: null, GraisseViscerale: 3.1 },
      },
    ],
  });
  const data = await res.json();
  assert.deepEqual(data.row, { d: D, p: 86.4, mg: 22.4, mm: 73.7, mh: null, gv: 3.1 });
});

test('écriture : refuse les valeurs absurdes sans appeler Grist', async () => {
  const calls = mockGrist(() => ok({}));
  const bad = [
    { d: D, p: 8.6 }, // poids trop bas
    { d: D, p: 860 }, // poids trop haut
    { d: D, p: '86' }, // pas un nombre
    { d: D, p: 86, mg: 120 }, // % impossible
    { d: D, p: null }, // poids manquant
    { d: D + 3600, p: 86 }, // pas minuit UTC
    { d: D + 30 * 86400, p: 86 }, // dans le futur
    { d: 12345, p: 86 }, // trop ancien
    { d: 1.5 * 86400, p: 86 },
    { p: 86 },
    null,
  ];
  for (const body of bad) {
    const res = await call('PUT', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await call('PUT', { body: '{pas du json' })).status, 400);
  assert.equal((await call('PUT', { body: { d: D, p: 86, junk: 'x'.repeat(5000) } })).status, 413);
  assert.equal(calls.length, 0);
});

test("écriture : ignore les champs inconnus (pas d'écriture dans d'autres colonnes)", async () => {
  const calls = mockGrist(() => ok({}));
  await call('PUT', { body: { d: D, p: 86, Id: 5, manualSort: 1, autre: 'x' } });
  const fields = JSON.parse(calls[0].init.body).records[0].fields;
  assert.deepEqual(Object.keys(fields).sort(), ['GraisseViscerale', 'MasseGrasse', 'MasseHydrique', 'MasseMusculaire', 'Poids']);
});

test('Grist en erreur : réponse 502 claire, sans fuite de détails', async () => {
  mockGrist(() => new Response('secret interne', { status: 500 }));
  const res = await call('GET');
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes('secret interne'));
  assert.ok(!text.includes('cle-secrete'));

  globalThis.fetch = async () => {
    throw new Error('réseau coupé');
  };
  assert.equal((await call('GET')).status, 502);
});

test('réglages manquants : erreur 500 sans appel à Grist', async () => {
  const calls = mockGrist(() => ok({}));
  const res = await worker.fetch(
    new Request('https://relais.test/poids', { headers: { 'X-Code': 'x', Origin: ORIGIN } }),
    { ...env, GRIST_API_KEY: undefined },
  );
  assert.equal(res.status, 500);
  assert.equal(calls.length, 0);
});

test('validate arrondit à une décimale', () => {
  const r = validate({ d: D, p: 86.45, mg: 22.04 }, D + 100);
  assert.equal(r.row.p, 86.5);
  assert.equal(r.row.mg, 22);
  assert.equal(r.row.mm, null);
});
