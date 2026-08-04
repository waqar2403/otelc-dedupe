// Tokenisation tuned for Go issue text: identifiers matter as much as prose.

// Boilerplate from the repo's issue templates. These appear in almost every
// body, so leaving them in inflates every pairwise score uniformly.
const TEMPLATE_NOISE = new Set([
  'describe', 'bug', 'steps', 'reproduce', 'expected', 'behavior', 'behaviour',
  'actual', 'environment', 'version', 'additional', 'context', 'screenshots',
  'description', 'proposed', 'solution', 'checklist', 'overview', 'problem',
  'statement', 'motivation', 'related', 'issue', 'issues', 'note', 'notes',
]);

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this',
  'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to',
  'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'it', 'its',
  'we', 'i', 'you', 'they', 'he', 'she', 'not', 'no', 'so', 'do', 'does',
  'did', 'can', 'could', 'would', 'should', 'will', 'when', 'where', 'which',
  'what', 'how', 'why', 'all', 'any', 'each', 'more', 'most', 'other', 'some',
  'such', 'only', 'own', 'same', 'up', 'out', 'about', 'into', 'over', 'also',
  'there', 'here', 'has', 'have', 'had', 'via', 'use', 'used', 'using',
  ...TEMPLATE_NOISE,
]);

// Fenced code blocks carry stack traces and logs. They are strong duplicate
// evidence (two people pasting the same panic) so we keep them, but we strip
// the fence markers themselves.
function stripMarkdown(s) {
  return s
    .replace(/```[a-z]*\n?/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')     // HTML comments in templates
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> link text
    .replace(/https?:\/\/\S+/g, ' ');
}

/**
 * Split camelCase / PascalCase into parts while ALSO keeping the whole symbol.
 * `canFlattenTJump` -> ['canflattentjump', 'can', 'flatten', 'jump']
 * This is what lets a lexical match fire on `isSetup` vs `isSetup()` vs
 * "is setup", which is exactly the #161 / #817 shape.
 */
function expandIdentifier(tok) {
  const out = [tok];
  const parts = tok
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_.\-/]+/)
    .filter((p) => p.length > 2);
  if (parts.length > 1) out.push(...parts);
  return out;
}

export function tokenize(raw) {
  if (!raw) return [];
  const text = stripMarkdown(String(raw));
  const rough = text.match(/[A-Za-z_][A-Za-z0-9_.\-/]*|\d+\.\d+\.\d+/g) || [];
  const out = [];
  for (const r of rough) {
    for (const t of expandIdentifier(r)) {
      const low = t.toLowerCase();
      if (low.length < 3 || low.length > 40) continue;
      if (STOP.has(low)) continue;
      if (/^\d+$/.test(low)) continue;
      out.push(low);
    }
  }
  return out;
}

/** Text handed to the embedder. Body is capped; title is prepended twice so it
 *  carries weight in the pooled vector without a separate weighting scheme. */
export function embedText(item, cap = 2000) {
  const body = stripMarkdown(item.body || '').replace(/\s+/g, ' ').trim();
  return `${item.title}\n${item.title}\n${body.slice(0, cap)}`;
}
