import { health } from '../scripts/lib/api.mjs';

export default async function handler(req, res) {
  try {
    const r = await health();
    res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(r.body));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}
