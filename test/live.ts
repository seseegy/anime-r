// Smoke test live: panggil handler Hono dengan fetch ASLI ke upstream
// Nanime. Bukan stub. Membuktikan wiring rute -> upstream benar-benar
// hidup. Jalankan terpisah: npm run test:live
import app from '../src/index.js';

const cases: Array<[string, string, string]> = [
  ['ping', '/ping', 'pong'],
  ['latest', '/anime/latest?page=1&limit=2', '"total":'],
  ['search live naruto', '/anime/search?q=naruto', 'Naruto'],
  ['detail 2779', '/anime/2779', 'Tokyo Revengers'],
  ['stream 39742', '/episode/39742', '1080p'],
  ['genres', '/anime/genres', 'Action'],
];

let fail = 0;
for (const [name, path, marker] of cases) {
  const t0 = Date.now();
  try {
    const res = await app.request(path, { headers: { 'cf-connecting-ip': `10.20.0.${Math.floor(Math.random() * 200) + 1}` } });
    const text = await res.text();
    const ok = res.status === 200 && text.includes(marker) && res.headers.get('x-creator') === 'rosyid';
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} [${Date.now() - t0}ms] status=${res.status} upstream=${res.headers.get('x-upstream-status')} ms=${res.headers.get('x-upstream-ms')} bytes=${text.length}`);
    if (!ok) { fail++; console.log('  isi awal:', text.slice(0, 200)); }
  } catch (e) {
    fail++;
    console.log(`FAIL ${name} ${(e as Error).message}`);
  }
}
console.log(fail ? `\n${fail} kasus live GAGAL` : '\nSemua smoke test live lolos');
process.exit(fail ? 1 : 0);
