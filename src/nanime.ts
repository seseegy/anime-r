// Port mentah (faithful port) dari gist ayashiiiyo/53ce9f08518f89544f2d68a306d6841e
// (modul Node.js `nanime.mjs`, 52 baris, zero dependencies).
//
// Aturan port ini:
// - Satu fungsi = satu endpoint upstream Nanime, path + nama parameter query
//   dipertahankan persis seperti modul aslinya.
// - Tidak ada parsing/normalisasi JSON: body upstream diteruskan byte-persis
//   (lihat `passthrough` di index.ts). Satu-satunya yang ditambah adalah
//   header debug X-Upstream-* dan X-Creator.
// - `downloadVideo` (node:fs / node:stream) TIDAK di-port: tidak ada di
//   Workers. Sebagai gantinya endpoint stream mengembalikan JSON mentah
//   upstream yang sudah berisi URL MP4 360p-1080p; klien mengunduh langsung.

export const UPSTREAM_BASE = 'https://mainappsv1.nanimeid.xyz/2.1.0';
export const UPSTREAM_USER_AGENT = 'Dart/3.5 (dart:io)';

export interface UpstreamResult {
  /** Status HTTP upstream, diteruskan apa adanya. */
  status: number;
  /** Body mentah upstream, byte-persis. */
  body: ArrayBuffer;
  contentType: string | null;
  /** Durasi panggilan upstream dalam ms. */
  ms: number;
  /** Path upstream yang dipanggil, termasuk query string. */
  path: string;
}

/** Panggilan mentah ke upstream. Melempar hanya bila jaringan gagal. */
export async function upstream(
  path: string,
  params?: Record<string, string | number | undefined>,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<UpstreamResult> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  const fullPath = qs ? `${path}?${qs}` : path;
  const started = Date.now();
  const res = await fetcher(`${UPSTREAM_BASE}${fullPath}`, {
    headers: { 'User-Agent': UPSTREAM_USER_AGENT },
  });
  return {
    status: res.status,
    body: await res.arrayBuffer(),
    contentType: res.headers.get('content-type'),
    ms: Date.now() - started,
    path: fullPath,
  };
}

/** Pemetaan 1:1 dari fungsi-fungsi nanime.mjs ke path upstream. */
export const upstreamPaths = {
  ping: () => ({ path: '/network-diag/ping' }),
  settings: () => ({ path: '/settings' }),
  latestAnime: (page = 1, limit = 20) => ({ path: '/anime/latest', params: { page, limit } }),
  popularDonghua: (page = 1, limit = 20) => ({ path: '/anime/popular/donghua', params: { page, limit } }),
  animeList: (page = 1, limit = 20) => ({ path: '/anime', params: { page, limit } }),
  /** Modul asli: ada `page` -> search-paginated, tanpa `page` -> live-search. */
  searchAnime: (q: string, page?: string, limit?: string) =>
    page
      ? { path: '/anime/search-paginated', params: { q, page, limit } }
      : { path: '/anime/live-search', params: { q } },
  animeDetail: (id: string) => ({ path: `/anime/${id}` }),
  animeEpisodes: (id: string) => ({ path: `/episode/anime/${id}` }),
  episodeStream: (id: string) => ({ path: `/episode/${id}` }),
  genres: () => ({ path: '/anime/genres' }),
  animeByGenre: (genre: string, page = 1, limit = 20) => ({
    path: `/anime/genre/${encodeURIComponent(genre)}`,
    params: { page, limit },
  }),
  schedule: () => ({ path: '/anime/schedule' }),
  catalog: (mode = 'all') => ({ path: '/anime/catalog', params: { mode } }),
  animeByLetter: (letter: string, page = 1, limit = 20) => ({
    path: '/anime/a-z',
    params: { letter, page, limit },
  }),
};
