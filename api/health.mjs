import { health } from '../scripts/lib/api.mjs';

export default async function handler(req, res) {
  try {
    const r = await health();
    res.writeHead(r.status, {
      'content-type': 'application/json',
      // Served from the CDN so the header line does not wait on a round trip to
      // the function region on every page load. Everything here tolerates being
      // a few seconds old: a check counter, a snapshot date, a corpus size.
      // stale-while-revalidate means the refresh never blocks a reader.
      'cache-control': r.status === 200
        ? 'public, max-age=0, s-maxage=15, stale-while-revalidate=60'
        : 'no-store',
    });
    res.end(JSON.stringify(r.body));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}
