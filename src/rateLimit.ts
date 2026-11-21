// Rate limit best-effort per isolate: sliding window di memori.
// Cloudflare Workers tidak punya state bersama antar isolate tanpa KV /
// Durable Objects, jadi angka 200/menit di sini ditegakkan per isolate
// per IP. Untuk penegakan global yang ketat, pakai Cloudflare Rate
// Limiting rules di dashboard (fase hardening), bukan kode ini.
const WINDOW_MS = 60_000;
const LIMIT = 200;

const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export function isRateLimited(ip: string, now = Date.now()): boolean {
  const cutoff = now - WINDOW_MS;
  const list = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  if (list.length >= LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  return false;
}

/** Sisa kuota dalam window berjalan (untuk header X-RateLimit-Remaining). */
export function remaining(ip: string, now = Date.now()): number {
  const cutoff = now - WINDOW_MS;
  const list = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  return Math.max(0, LIMIT - list.length);
}

/** Sisa detik sampai window bergulir, untuk header Retry-After. */
export function retryAfterSeconds(ip: string, now = Date.now()): number {
  const list = hits.get(ip) ?? [];
  if (list.length === 0) return 60;
  return Math.max(1, Math.ceil((list[0] + WINDOW_MS - now) / 1000));
}

/** Hanya untuk tes in-process. */
export function resetRateLimit(): void {
  hits.clear();
}

export const RATE_LIMIT = LIMIT;
export const RATE_WINDOW_MS = WINDOW_MS;
