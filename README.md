# anime-r

REST API anime Nanime, raw passthrough, Cloudflare Workers + Hono.

Creator: **rosyid**

Upstream: API resmi Nanime (`com.nanime.id` v3.2.0.0) di
`https://mainappsv1.nanimeid.xyz/2.1.0`, dipanggil dengan header
`User-Agent: Dart/3.5 (dart:io)`. Data sumber upstream adalah agregator
kuramanime (`provider_source: kuramanime` di item katalog).

Port mentah (faithful port) dari gist
[ayashiiiyo/53ce9f08518f89544f2d68a306d6841e](https://gist.github.com/ayashiiiyo/53ce9f08518f89544f2d68a306d6841e)
(modul Node.js `nanime.mjs`, 52 baris, zero dependencies): satu fungsi =
satu endpoint, path dan nama parameter query dipertahankan persis.

## Keputusan desain

- **Tetap mentah**: semua rute API meneruskan status HTTP dan body upstream
  apa adanya, byte-persis. Tidak ada envelope `{ok, data, meta}` dan tidak
  ada normalisasi. Yang ditambah hanya header debug `X-Upstream-Status`,
  `X-Upstream-Ms`, `X-Upstream-Path`, dan `X-Creator: rosyid`.
- **Tanpa API key**, rate limit **200 request/menit per IP** (sliding window
  di memori, per isolate Workers; penegakan global yang ketat butuh
  Cloudflare Rate Limiting rules — lihat catatan di `src/rateLimit.ts`).
  Yang kena limit dapat 429 + header `Retry-After`. Root `/` dan `/docs`
  tidak kena limit.
- **JSON di Workers** (TypeScript + Hono). Domain dulu `*.workers.dev`.
- **Stream mentah**: `GET /episode/:id` mengembalikan JSON mentah upstream
  yang berisi URL MP4 360p–1080p. Tidak ada proxy/download video di Worker
  (`downloadVideo` di modul asli pakai `node:fs`/`node:stream` yang tidak
  ada di Workers); klien mengunduh langsung dari URL tersebut.
- **Upstream gagal total** (jaringan putus) → 502 JSON buatan sendiri
  `{creator, error: "upstream_unreachable", ...}`. Error HTTP upstream
  (mis. 404) diteruskan apa adanya, bukan diubah jadi 502.

## Endpoint

| Method | Path | Upstream |
| --- | --- | --- |
| GET | `/` | Info API + daftar endpoint |
| GET | `/docs` | Dokumentasi HTML |
| GET | `/ping` | `/network-diag/ping` |
| GET | `/settings` | `/settings` |
| GET | `/anime/latest?page=1&limit=20` | `/anime/latest` |
| GET | `/anime/popular/donghua?page=1&limit=20` | `/anime/popular/donghua` |
| GET | `/anime?page=1&limit=20` | `/anime` |
| GET | `/anime/search?q=naruto` | `/anime/live-search` (tanpa `page`) |
| GET | `/anime/search?q=naruto&page=1&limit=20` | `/anime/search-paginated` (dengan `page`) |
| GET | `/anime/:id` | `/anime/:id` |
| GET | `/anime/:id/episodes` | `/episode/anime/:id` |
| GET | `/episode/:id` | `/episode/:id` |
| GET | `/anime/genres` | `/anime/genres` |
| GET | `/anime/genre/:genre?page=1&limit=20` | `/anime/genre/:genre` |
| GET | `/anime/schedule` | `/anime/schedule` |
| GET | `/anime/catalog?mode=all` | `/anime/catalog` |
| GET | `/anime/a-z?letter=A&page=1&limit=20` | `/anime/a-z` |

Contoh:

```bash
curl https://anime-r.<akun>.workers.dev/anime/latest?page=1\&limit=2
curl https://anime-r.<akun>.workers.dev/anime/search?q=naruto
curl https://anime-r.<akun>.workers.dev/episode/39742
```

## Pengembangan

```bash
npm install
npm run dev        # wrangler dev (butuh login Cloudflare)
npm start          # server Node lokal di :8787 (tsx src/server.ts)
npm test           # tes in-process: stub upstream, 99 checks
npm run test:live  # smoke test ke upstream Nanime asli (butuh internet)
npm run typecheck
npm run deploy     # wrangler deploy
```

## Verifikasi

- Tes in-process (`npm test`): **99 lolos, 0 gagal** — byte-persis body,
  status diteruskan, query diteruskan ke path upstream yang benar, header
  debug + creator, upstream 404 diteruskan, upstream mati → 502, validasi
  `q`/`letter`, rate limit 200 lolos lalu ke-201 kena 429.
- Smoke test live (`npm run test:live`): **6/6 lolos** ke upstream asli
  (ping, latest, search `naruto`, detail 2779, stream 39742, genres).
- `npm run typecheck`: bersih. `wrangler deploy --dry-run`: bundle
  71,88 KiB, no bindings.
- Tes upstream mentah sebelumnya (modul `nanime.mjs` langsung, 21 Nov
  2026): 16/16 fungsi lolos — anime terbaru total 2.434, genre 125,
  stream episode 39742 kualitas 360p–1080p.

## Struktur

```
src/
  index.ts      # App Hono: rute, passthrough, rate limit, /docs
  nanime.ts     # Klien upstream + pemetaan path (port nanime.mjs)
  rateLimit.ts  # Rate limit 200/menit per IP (sliding window, memori)
  server.ts     # Server Node lokal (dev saja)
test/
  run.ts        # Tes in-process dengan stub fetch
  live.ts       # Smoke test live ke upstream asli
```

## Yang belum / langkah berikut

- Deploy ke Cloudflare (`wrangler deploy` atau via dashboard) lalu tes
  egress Workers: apakah IP Workers kena 403 upstream atau tidak.
- Hardening (fase 2): Cache API untuk rute yang jarang berubah, pemetaan
  error yang lebih rapi, halaman `/docs` yang lebih lengkap.
- Sambung ke Animeru (APK) sebagai sumber data.
