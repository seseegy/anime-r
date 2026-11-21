import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { upstream, upstreamPaths, type UpstreamResult } from './nanime.js';
import {
  clientIp,
  isRateLimited,
  resetRateLimit,
  retryAfterSeconds,
  RATE_LIMIT,
} from './rateLimit.js';

export const CREATOR = 'rosyid';
export { resetRateLimit };

const app = new Hono();

function passthroughResponse(up: UpstreamResult): Response {
  return new Response(up.body, {
    status: up.status,
    headers: {
      'content-type': up.contentType ?? 'application/json',
      'x-creator': CREATOR,
      'x-upstream-status': String(up.status),
      'x-upstream-ms': String(up.ms),
      'x-upstream-path': up.path,
      'cache-control': 'no-store',
    },
  });
}

async function passthrough(
  c: Context,
  target: { path: string; params?: Record<string, string | number | undefined> },
): Promise<Response> {
  let up: UpstreamResult;
  try {
    up = await upstream(target.path, target.params);
  } catch (err) {
    // Hanya kegagalan jaringan yang sampai sini; error HTTP upstream
    // (404/500/...) diteruskan apa adanya sebagai passthrough, bukan 502.
    return c.json(
      {
        creator: CREATOR,
        error: 'upstream_unreachable',
        message: 'Upstream Nanime tidak bisa dihubungi.',
        upstream_path: target.path,
        detail: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
  return passthroughResponse(up);
}

const errorJson = (c: Context, status: ContentfulStatusCode, error: string, message: string) =>
  c.json({ creator: CREATOR, error, message }, status);

// Rate limit 200/menit per IP, hanya untuk rute API. Root dan /docs bebas.
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/' || path === '/docs') return next();
  const ip = clientIp(c.req.raw);
  if (isRateLimited(ip)) {
    c.header('Retry-After', String(retryAfterSeconds(ip)));
    return errorJson(c, 429, 'rate_limited', `Rate limit ${RATE_LIMIT} request per menit terlampaui.`);
  }
  await next();
});

const ENDPOINTS = [
  { method: 'GET', path: '/ping', upstream: '/network-diag/ping', desc: 'Cek koneksi upstream (pong)' },
  { method: 'GET', path: '/settings', upstream: '/settings', desc: 'Pengaturan aplikasi Nanime' },
  { method: 'GET', path: '/anime/latest?page=1&limit=20', upstream: '/anime/latest', desc: 'Anime terbaru' },
  { method: 'GET', path: '/anime/popular/donghua?page=1&limit=20', upstream: '/anime/popular/donghua', desc: 'Donghua populer' },
  { method: 'GET', path: '/anime?page=1&limit=20', upstream: '/anime', desc: 'Daftar anime' },
  { method: 'GET', path: '/anime/search?q=naruto', upstream: '/anime/live-search', desc: 'Search live (tanpa page)' },
  { method: 'GET', path: '/anime/search?q=naruto&page=1&limit=20', upstream: '/anime/search-paginated', desc: 'Search berpaginasi (dengan page)' },
  { method: 'GET', path: '/anime/:id', upstream: '/anime/:id', desc: 'Detail anime' },
  { method: 'GET', path: '/anime/:id/episodes', upstream: '/episode/anime/:id', desc: 'Daftar episode anime' },
  { method: 'GET', path: '/episode/:id', upstream: '/episode/:id', desc: 'Stream episode (JSON mentah berisi URL MP4 360p-1080p)' },
  { method: 'GET', path: '/anime/genres', upstream: '/anime/genres', desc: 'Daftar genre' },
  { method: 'GET', path: '/anime/genre/:genre?page=1&limit=20', upstream: '/anime/genre/:genre', desc: 'Anime per genre' },
  { method: 'GET', path: '/anime/schedule', upstream: '/anime/schedule', desc: 'Jadwal rilis 10 hari ke depan' },
  { method: 'GET', path: '/anime/catalog?mode=all', upstream: '/anime/catalog', desc: 'Katalog indeks per huruf' },
  { method: 'GET', path: '/anime/a-z?letter=A&page=1&limit=20', upstream: '/anime/a-z', desc: 'Anime per huruf' },
];

app.get('/', (c) =>
  c.json({
    creator: CREATOR,
    name: 'anime-r',
    description: 'REST API anime Nanime, raw passthrough, Cloudflare Workers + Hono.',
    upstream: 'https://mainappsv1.nanimeid.xyz/2.1.0',
    upstream_source: 'kuramanime (via Nanime)',
    docs: '/docs',
    rate_limit: `${RATE_LIMIT}/menit per IP, tanpa API key`,
    note: 'Semua rute API meneruskan status + body upstream apa adanya (mentah). Stream mengembalikan JSON berisi URL MP4, bukan file video.',
    endpoints: ENDPOINTS,
  }),
);

app.get('/docs', (c) => {
  const rows = ENDPOINTS.map(
    (e) => `<tr><td><code>GET</code></td><td><code>${e.path}</code></td><td>${e.desc}</td></tr>`,
  ).join('');
  return c.html(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>anime-r — REST API anime Nanime</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.5}code{background:#eee;padding:.1em .3em;border-radius:4px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.4em .6em;text-align:left;vertical-align:top}</style></head><body><h1>anime-r</h1><p>REST API anime Nanime, raw passthrough. Creator: <strong>rosyid</strong>. Tanpa API key, rate limit ${RATE_LIMIT}/menit per IP.</p><p>Semua rute API meneruskan status dan body upstream apa adanya. Header debug: <code>X-Upstream-Status</code>, <code>X-Upstream-Ms</code>, <code>X-Upstream-Path</code>, <code>X-Creator</code>.</p><table><tr><th>Method</th><th>Path</th><th>Keterangan</th></tr>${rows}</table><p>Stream (<code>/episode/:id</code>) mengembalikan JSON mentah berisi URL MP4 360p–1080p; unduh langsung dari URL tersebut.</p></body></html>`);
});

// Rute statis dulu sebelum rute berparameter, supaya /anime/search dan
// /anime/genres tidak ketangkap /anime/:id.
app.get('/ping', (c) => passthrough(c, upstreamPaths.ping()));
app.get('/settings', (c) => passthrough(c, upstreamPaths.settings()));
app.get('/anime/latest', (c) =>
  passthrough(c, upstreamPaths.latestAnime(Number(c.req.query('page') ?? 1), Number(c.req.query('limit') ?? 20))),
);
app.get('/anime/popular/donghua', (c) =>
  passthrough(c, upstreamPaths.popularDonghua(Number(c.req.query('page') ?? 1), Number(c.req.query('limit') ?? 20))),
);
app.get('/anime/search', (c) => {
  const q = c.req.query('q');
  if (!q) return errorJson(c, 400, 'missing_query', 'Parameter q wajib diisi, contoh: /anime/search?q=naruto');
  return passthrough(c, upstreamPaths.searchAnime(q, c.req.query('page'), c.req.query('limit')));
});
app.get('/anime/genres', (c) => passthrough(c, upstreamPaths.genres()));
app.get('/anime/genre/:genre', (c) =>
  passthrough(
    c,
    upstreamPaths.animeByGenre(c.req.param('genre'), Number(c.req.query('page') ?? 1), Number(c.req.query('limit') ?? 20)),
  ),
);
app.get('/anime/schedule', (c) => passthrough(c, upstreamPaths.schedule()));
app.get('/anime/catalog', (c) => passthrough(c, upstreamPaths.catalog(c.req.query('mode') ?? 'all')));
app.get('/anime/a-z', (c) => {
  const letter = c.req.query('letter');
  if (!letter) return errorJson(c, 400, 'missing_query', 'Parameter letter wajib diisi, contoh: /anime/a-z?letter=A');
  return passthrough(
    c,
    upstreamPaths.animeByLetter(letter, Number(c.req.query('page') ?? 1), Number(c.req.query('limit') ?? 20)),
  );
});
app.get('/anime', (c) =>
  passthrough(c, upstreamPaths.animeList(Number(c.req.query('page') ?? 1), Number(c.req.query('limit') ?? 20))),
);
app.get('/anime/:id', (c) => passthrough(c, upstreamPaths.animeDetail(c.req.param('id'))));
app.get('/anime/:id/episodes', (c) => passthrough(c, upstreamPaths.animeEpisodes(c.req.param('id'))));
app.get('/episode/:id', (c) => passthrough(c, upstreamPaths.episodeStream(c.req.param('id'))));

app.notFound((c) => errorJson(c, 404, 'not_found', 'Rute tidak ditemukan. Lihat /docs untuk daftar endpoint.'));
app.onError((err, c) => {
  console.error(err);
  return errorJson(c, 500, 'internal_error', 'Terjadi kesalahan internal.');
});

export default app;
