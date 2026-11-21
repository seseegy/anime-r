// Tes in-process: stub global fetch, lalu panggil app.request().
// Membuktikan: body upstream diteruskan BYTE-PERSIS (bukan di-parse lalu
// di-stringify ulang), status diteruskan, query diteruskan ke path yang
// benar, header debug + creator ada, error upstream -> 502, rate limit
// 200/menit -> 429 pada request ke-201.
import app, { resetRateLimit } from '../src/index.js';

const UPSTREAM = 'https://mainappsv1.nanimeid.xyz/2.1.0';

let calls: string[] = [];
let failUpstream = false;

const canned: Record<string, { status: number; body: string }> = {
  '/network-diag/ping': { status: 200, body: '{"message":"pong","status":200}' },
  '/settings': { status: 200, body: '{"message":"OK","settings":{"maintenance_enabled":false}}' },
  '/anime/latest?page=1&limit=2': { status: 200, body: '{"status":200,"items":[{"id":1}],"total":2434}' },
  '/anime/popular/donghua?page=1&limit=2': { status: 200, body: '{"status":200,"items":[],"total":104}' },
  '/anime?page=1&limit=2': { status: 200, body: '{"status":200,"data":[{"id":1}]}' },
  '/anime/live-search?q=naruto': { status: 200, body: '{"status":200,"data":[{"id":270,"nama_anime":"Naruto: Shippuden"}]}' },
  '/anime/search-paginated?q=naruto&page=1&limit=2': { status: 200, body: '{"status":200,"data":[{"id":270}]}' },
  '/anime/2779': { status: 200, body: '{"status":200,"data":{"id":2779,"nama_anime":"Tokyo Revengers: Santen Sensou-hen"}}' },
  '/episode/anime/2779': { status: 200, body: '{"status":200,"data":[{"id":35404,"nomor_episode":1}]}' },
  '/episode/39742': { status: 200, body: '{"status":200,"data":{"judul_episode":"Episode 8","qualities":[{"nama_quality":"360p"}]}}' },
  '/anime/genres': { status: 200, body: '{"status":200,"data":{"genres":["Action","Adventure"]}}' },
  '/anime/genre/Action?page=1&limit=2': { status: 200, body: '{"status":200,"items":[],"total":1245}' },
  '/anime/schedule': { status: 200, body: '{"status":200,"data":{"2026-11-21":{"anime":[]}}}' },
  '/anime/catalog?mode=all': { status: 200, body: '{"mode":"all","catalog":{}}' },
  '/anime/a-z?letter=A&page=1&limit=2': { status: 200, body: '{"status":200,"data":[{"id":1}]}' },
  '/anime/999999': { status: 404, body: '{"status":404,"message":"not found"}' },
};

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  calls.push(url);
  if (failUpstream) throw new Error('jaringan putus (simulasi)');
  const path = url.slice(UPSTREAM.length);
  const hit = canned[path];
  if (!hit) return new Response(`{"status":404,"message":"tidak ada stub untuk ${path}"}`, { status: 404, headers: { 'content-type': 'application/json' } });
  return new Response(hit.body, { status: hit.status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

let pass = 0;
let fail = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; results.push(`PASS ${name}`); }
  else { fail++; results.push(`FAIL ${name} ${detail}`); }
}

// IP berbeda per kelompok tes supaya rate limit tidak saling mengganggu.
const ip = (n: number) => ({ 'cf-connecting-ip': `10.0.0.${n}` });
const get = (path: string, n = 1) => app.request(path, { headers: ip(n) });

async function expectPassthrough(name: string, path: string, upstreamPath: string, n: number) {
  calls = [];
  const res = await get(path, n);
  const text = await res.text();
  const hit = canned[upstreamPath];
  check(`${name}: status diteruskan`, res.status === hit.status, `dapat ${res.status}, mau ${hit.status}`);
  check(`${name}: body byte-persis`, text === hit.body, `dapat ${text.slice(0, 120)}`);
  check(`${name}: header x-creator=rosyid`, res.headers.get('x-creator') === 'rosyid');
  check(`${name}: header x-upstream-status`, res.headers.get('x-upstream-status') === String(hit.status));
  check(`${name}: header x-upstream-path`, res.headers.get('x-upstream-path') === upstreamPath);
  check(`${name}: upstream dipanggil di path benar`, calls[0] === UPSTREAM + upstreamPath, `dapat ${calls[0]}`);
}

await expectPassthrough('ping', '/ping', '/network-diag/ping', 1);
await expectPassthrough('settings (tanpa field status)', '/settings', '/settings', 2);
await expectPassthrough('latest', '/anime/latest?page=1&limit=2', '/anime/latest?page=1&limit=2', 3);
await expectPassthrough('popular donghua', '/anime/popular/donghua?page=1&limit=2', '/anime/popular/donghua?page=1&limit=2', 4);
await expectPassthrough('daftar anime', '/anime?page=1&limit=2', '/anime?page=1&limit=2', 5);
await expectPassthrough('search live', '/anime/search?q=naruto', '/anime/live-search?q=naruto', 6);
await expectPassthrough('search paginated', '/anime/search?q=naruto&page=1&limit=2', '/anime/search-paginated?q=naruto&page=1&limit=2', 7);
await expectPassthrough('detail anime', '/anime/2779', '/anime/2779', 8);
await expectPassthrough('daftar episode', '/anime/2779/episodes', '/episode/anime/2779', 9);
await expectPassthrough('stream episode', '/episode/39742', '/episode/39742', 10);
await expectPassthrough('genres', '/anime/genres', '/anime/genres', 11);
await expectPassthrough('anime per genre', '/anime/genre/Action?page=1&limit=2', '/anime/genre/Action?page=1&limit=2', 12);
await expectPassthrough('jadwal', '/anime/schedule', '/anime/schedule', 13);
await expectPassthrough('katalog', '/anime/catalog?mode=all', '/anime/catalog?mode=all', 14);
await expectPassthrough('anime per huruf', '/anime/a-z?letter=A&page=1&limit=2', '/anime/a-z?letter=A&page=1&limit=2', 15);

// Upstream 404 diteruskan apa adanya, bukan diubah jadi 502.
{
  const res = await get('/anime/999999', 16);
  check('upstream 404 diteruskan', res.status === 404 && (await res.text()) === '{"status":404,"message":"not found"}');
}

// Upstream mati (jaringan gagal) -> 502 JSON buatan sendiri.
{
  failUpstream = true;
  const res = await get('/ping', 17);
  const body = await res.json() as Record<string, unknown>;
  check('upstream mati -> 502', res.status === 502 && body.creator === 'rosyid' && body.error === 'upstream_unreachable');
  failUpstream = false;
}

// Validasi query wajib.
{
  const res = await get('/anime/search', 18);
  check('search tanpa q -> 400', res.status === 400);
  const res2 = await get('/anime/a-z', 18);
  check('a-z tanpa letter -> 400', res2.status === 400);
}

// Root + docs.
{
  const res = await get('/', 19);
  const body = await res.json() as Record<string, unknown>;
  check('root: creator rosyid + daftar endpoint', res.status === 200 && body.creator === 'rosyid' && Array.isArray(body.endpoints));
  const docs = await get('/docs', 19);
  const html = await docs.text();
  check('docs: HTML 200 berisi endpoint', docs.status === 200 && html.includes('/anime/search') && html.includes('rosyid'));
  const nf = await get('/rute-ngawur', 19);
  check('rute ngawur -> 404 JSON', nf.status === 404 && ((await nf.json()) as Record<string, unknown>).creator === 'rosyid');
}

// Rate limit: 200 lolos, ke-201 kena 429.
{
  resetRateLimit();
  let okCount = 0;
  let limited = 0;
  for (let i = 0; i < 201; i++) {
    const res = await app.request('/ping', { headers: { 'cf-connecting-ip': '10.9.9.9' } });
    if (res.status === 200) okCount++;
    else if (res.status === 429) limited++;
    await res.text();
  }
  check('rate limit: 200 lolos', okCount === 200, `dapat ${okCount}`);
  check('rate limit: ke-201 kena 429', limited === 1, `dapat ${limited}`);
}

for (const r of results) console.log(r);
console.log(`\nRINGKASAN: ${pass} lolos, ${fail} gagal`);
process.exit(fail ? 1 : 0);
