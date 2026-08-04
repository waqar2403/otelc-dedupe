const $ = (s) => document.querySelector(s);
const out = $('#out');

const EXAMPLES = {
  dup: {
    kind: 'PR',
    title: 'fix(tool): check file.Close error handling in ImportConfig and AST WriteFile',
    body: `During inspection of the tool module we audited file write routines (ImportConfig.WriteFile in tool/internal/imports/importcfg.go and ast.WriteFile in tool/internal/ast/parser.go).

Ignoring the file.Close() return value can hide I/O or storage errors such as disk quota limits or flush failures, leading to undetected file truncation. Explicitly invoke and check file.Close() and return any close error wrapped with ex.Wrapf.`,
  },
  series: {
    kind: 'PR',
    title: 'chore(test): add multi-process e2e for gRPC to SQL propagation',
    body: `Adds an end-to-end test that spans two processes: a gRPC client calling a server which then issues a database/sql query, asserting that trace context propagates across the process boundary and that the SQL span is a child of the gRPC server span.

Follows the same harness shape as the existing HTTP to SQL propagation test.`,
  },
  new: {
    kind: 'ISSUE',
    title: 'feat(instrumentation): add support for nats.go publish and subscribe',
    body: `otelc has no instrumentation for the NATS client (github.com/nats-io/nats.go). Publishing and subscribing produce no spans, so message flows through NATS break the trace.

Proposal: add producer and consumer hooks emitting messaging.* semantic convention attributes, following the kafka-go instrumentation layout.`,
  },
};

// ---- health ---------------------------------------------------------------
fetch('/api/health').then((r) => r.json()).then((h) => {
  $('#health').innerHTML = h.judgeConfigured
    ? `<b>${h.usedToday}</b> of <b>${h.dailyCap}</b> checks used today`
    : `<span class="off">scoring disabled — no API key configured, showing keyword matches only</span>`;
}).catch(() => { $('#health').textContent = 'server unreachable'; });

// ---- form -----------------------------------------------------------------
$('#body').addEventListener('input', (e) => {
  $('#counter').textContent = `${e.target.value.length} / 4000`;
});
document.querySelectorAll('[data-ex]').forEach((b) => {
  b.addEventListener('click', () => {
    const ex = EXAMPLES[b.dataset.ex];
    $('#kind').value = ex.kind; $('#title').value = ex.title; $('#body').value = ex.body;
    $('#counter').textContent = `${ex.body.length} / 4000`;
    $('#form').dispatchEvent(new Event('submit', { cancelable: true }));
  });
});

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = { kind: $('#kind').value, title: $('#title').value, body: $('#body').value };
  if (!payload.title.trim()) return;

  $('#go').disabled = true;
  out.innerHTML = `<div class="empty"><span class="spin"></span>searching 947 items…</div>`;
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    render(data);
  } catch (err) {
    out.innerHTML = `<div class="err"><strong>Request failed.</strong> ${esc(err.message)}</div>`;
  } finally { $('#go').disabled = false; }
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ORDER = { duplicate: 0, subsumed_by: 1, subsumes: 2, series: 3, related: 4, unrelated: 5 };

// Bands, not raw numbers. Each label states what was actually measured on the
// 14-case labelled set (scripts/judge-eval.mjs) so the wording is backed by
// evidence rather than asserted. A bare "Score: 542" tells a reader nothing.
function band(L) {
  if (L === null || L === undefined) return null;
  if (L >= 90) return { k: 'high', label: 'very likely the same work', note: '7/7 correct at this level in the eval' };
  if (L >= 70) return { k: 'mid', label: 'probably the same work', note: 'no eval cases landed here — treat with care' };
  if (L >= 40) return { k: 'mid', label: 'genuinely uncertain', note: 'no eval cases landed here — read both yourself' };
  if (L >= 10) return { k: 'low', label: 'probably distinct work', note: '0/7 were duplicates at this level' };
  return { k: 'low', label: 'clearly distinct', note: '0/5 were duplicates at this level' };
}

function render(d) {
  if (!d.candidates?.length) {
    out.innerHTML = `<div class="summary clear"><strong>No significant overlap found.</strong>
      Nothing already filed looks close to this. Looks safe to file.</div>`;
    return;
  }
  const items = [...d.candidates].sort((a, b) =>
    (ORDER[a.judgement?.verdict] ?? 9) - (ORDER[b.judgement?.verdict] ?? 9) ||
    b.retrieval.fused - a.retrieval.fused);

  const dups = items.filter((i) => (i.judgement?.likelihood ?? 0) >= 70);
  let head;
  if (d.verdictSource !== 'judge') {
    head = `<div class="summary warn"><strong>Retrieval only — no verdicts.</strong>
      ${esc(d.judgeError || 'The judge is not configured.')}<br>
      These are the closest items by keyword and file overlap, in rank order. Ranking alone
      cannot tell a duplicate from a deliberate series, so read them yourself.</div>`;
  } else if (dups.length) {
    head = `<div class="summary warn"><strong>${dups.length} item${dups.length === 1 ? '' : 's'}
      scored 70 or above</strong> for being the same work:
      ${dups.map((x) => `<a href="${x.url}">#${x.number}</a> (${x.judgement.likelihood})`).join(', ')}.
      Worth reading before you file. Nothing here is a ruling.
      <span class="mono">${d.usage ? `${d.usage.total_tokens} tok` : ''}</span></div>`;
  } else {
    head = `<div class="summary clear"><strong>Nothing scored above 70.</strong>
      ${items.length} nearby items were assessed and none looks like the same work.
      <span class="mono">${d.usage ? `${d.usage.total_tokens} tok` : ''}</span></div>`;
  }

  out.innerHTML = head + items.map((i) => {
    const j = i.judgement;
    const state = i.state === 'OPEN' ? 'open' : i.merged ? 'merged' : 'closed';
    const from = Object.entries(i.retrieval.from)
      .map(([k, v]) => `${k}#${v.rank}`).join(' · ');
    const b = band(j?.likelihood);
    return `<article class="card ${j?.verdict || ''}">
      <h3>${b ? `<span class="score s-${b.k}">${j.likelihood}</span>` : ''}
        <a href="${i.url}" target="_blank" rel="noopener">#${i.number}</a> ${esc(i.title)}</h3>
      <div class="meta">${i.kind} · ${state} · ${esc(i.author)} · ${i.createdAt.slice(0, 10)}${
        j ? ` · ${j.verdict.replace('_', ' ')}` : ''}</div>
      ${b ? `<p class="reason"><strong>${b.label}.</strong> ${j.reason ? esc(j.reason) : ''}</p>
             <div class="why">${b.note} · matched by ${from}</div>`
          : `<div class="why">matched by ${from}</div>`}
    </article>`;
  }).join('');
}
