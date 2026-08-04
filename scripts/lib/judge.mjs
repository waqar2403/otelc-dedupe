// Provider-agnostic judge. DeepSeek and Groq are both OpenAI-chat-compatible,
// so one client covers them; swapping is a base-URL and model change.
//
// The judge exists because hand-tuned scoring provably cannot do this job.
// Rules that removed the #947/#931 series also removed #903/#916 and
// #790/#939, which are real duplicates. Series-vs-duplicate is a semantic
// call, so it gets a semantic tool.

// Model ids verified against api-docs.deepseek.com/quick_start/pricing on
// 2026-08-04. v4-flash is $0.14/M in, $0.28/M out; v4-pro is $0.435/$0.87.
// Override either with SCOUT_MODEL.
export const PROVIDERS = {
  deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', env: 'DEEPSEEK_API_KEY' },
  groq: { base: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', env: 'GROQ_API_KEY' },
};

export const VERDICTS = ['duplicate', 'subsumes', 'subsumed_by', 'series', 'related', 'unrelated'];

const SYSTEM = `You triage GitHub issues and pull requests for the OpenTelemetry Go compile-time instrumentation repository (otelc).

You are given a PROPOSED item and a numbered list of EXISTING items retrieved as possible matches. For each candidate, decide the relationship to the PROPOSED item.

Verdicts:
- duplicate: same underlying work. Filing both is wasted effort.
- subsumes: the PROPOSED item covers everything the candidate covers, and more.
- subsumed_by: the candidate already covers everything the PROPOSED item covers.
- series: same pattern or component, but deliberately different subjects. Two PRs fixing the same lint across different files, or adding e2e tests for gRPC and for HTTP, are a SERIES, not duplicates. This is the most common mistake, so weigh it carefully.
- related: same area, genuinely different work.
- unrelated: retrieval noise.

Rules:
1. Judge by what the work CHANGES, not by how the titles are worded. Similar titles with different targets are a series.
2. If a candidate is already MERGED or CLOSED and the proposed work is the same, say subsumed_by and note it has already landed.
3. Same author is not evidence of duplication by itself. People deliberately split work.
4. Different files usually means different work, even with near-identical titles.
5. Be conservative. Prefer "related" over "duplicate" when unsure. A wrong "duplicate" discourages a legitimate contribution.

Reply with JSON only, no prose:
{"results":[{"number":<int>,"verdict":"<one of the verdicts>","confidence":<0-100>,"reason":"<one sentence, max 25 words>"}]}
Include every candidate exactly once. Reference candidates by their issue NUMBER, never by list position.`;

function renderCandidate(c, bodyCap) {
  const state = c.state === 'OPEN' ? 'open' : c.merged ? 'MERGED' : 'closed';
  const files = c.files?.length
    ? `\nfiles: ${c.files.slice(0, 12).join(', ')}${c.files.length > 12 ? ` (+${c.files.length - 12})` : ''}`
    : '';
  const body = (c.body || '').replace(/\s+/g, ' ').trim().slice(0, bodyCap);
  return `#${c.number} [${c.kind} ${state}] by ${c.author}\ntitle: ${c.title}${files}\n${body}`;
}

/**
 * @param proposed {{title, body, files?}}
 * @param candidates corpus items
 * @param opts {{provider, apiKey, bodyCap, maxTokens, signal}}
 */
export async function judge(proposed, candidates, opts = {}) {
  const p = PROVIDERS[opts.provider || 'deepseek'];
  if (!p) throw new Error(`unknown provider ${opts.provider}`);
  const apiKey = opts.apiKey || process.env[p.env];
  if (!apiKey) {
    const err = new Error(`no API key: set ${p.env} or send x-api-key`);
    err.code = 'NO_KEY';
    throw err;
  }
  const bodyCap = opts.bodyCap ?? 600;

  const user =
    `PROPOSED (${proposed.kind || 'ISSUE'}):\ntitle: ${proposed.title}\n` +
    (proposed.files?.length ? `files: ${proposed.files.slice(0, 12).join(', ')}\n` : '') +
    `${(proposed.body || '').replace(/\s+/g, ' ').slice(0, 2000)}\n\n` +
    `EXISTING CANDIDATES (${candidates.length}):\n\n` +
    candidates.map((c) => renderCandidate(c, bodyCap)).join('\n\n---\n\n');

  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: opts.model || process.env.SCOUT_MODEL || p.model,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: opts.maxTokens ?? 900,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${p.model} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { const e = new Error('judge returned non-JSON'); e.code = 'BAD_JSON'; throw e; }

  // Validate rather than cast. apicurio-scout's `JSON.parse(x) as GroqReport`
  // is how a malformed reply becomes a silent wrong answer.
  const valid = new Set(candidates.map((c) => c.number));
  const results = [];
  for (const r of parsed.results || []) {
    const n = Number(r.number);
    if (!valid.has(n)) continue;                       // hallucinated or index-not-number
    if (!VERDICTS.includes(r.verdict)) continue;
    results.push({
      number: n,
      verdict: r.verdict,
      confidence: Math.max(0, Math.min(100, Number(r.confidence) || 0)),
      reason: String(r.reason || '').slice(0, 200),
    });
  }
  return {
    results,
    usage: data.usage || null,
    model: opts.model || process.env.SCOUT_MODEL || p.model,
    dropped: (parsed.results || []).length - results.length,
  };
}
