import type { Finding, RunDiff, RunResult } from '../types.ts';
import { escapeHtml as e } from './escape.ts';
import { splitRepeated } from './group.ts';
import type { RuleGroup } from './group.ts';
import { SEVERITY_NAMES } from '../types.ts';
import { groupName, kindLabel, levelLabel, noEngineLine, runLabel, summaryLine } from './markdown.ts';

// Dark only, neutral greys: the same tokens as the web page (ui/src/index.css). No external resources, the server sends a strict CSP.
const STYLE = `
:root { color-scheme: dark; --bg: #171717; --fg: #f4f4f4; --muted: #a8a8a8; --panel: #1f1f1f; --line: rgb(255 255 255 / 0.08); --error: #f26d6d; --warning: #e8a33d; --radius: 0.625rem; }
html { font-size: 17px; }
body { font-family: 'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; line-height: 1.55; background: var(--bg); color: var(--fg); max-width: 48rem; margin: 0 auto; padding: 4rem 1rem; }
h1, h2, h3 { line-height: 1.25; font-weight: 600; letter-spacing: -0.01em; }
h1 { font-size: 1.75rem; margin: 0 0 0.5rem; }
h2 { font-size: 1.25rem; margin: 3rem 0 1rem; }
h3 { font-size: 1rem; margin: 2rem 0 0.5rem; overflow-wrap: anywhere; }
p { margin: 0.5rem 0; }
ul { padding-left: 1.25rem; }
li { margin: 0.35rem 0; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
th, td { text-align: left; vertical-align: top; padding: 0.5rem 0.75rem 0.5rem 0; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 500; font-size: 0.875rem; }
code { font-family: inherit; color: var(--muted); font-size: 0.9em; }
a { color: var(--fg); text-decoration: underline; text-decoration-color: var(--muted); text-underline-offset: 0.15em; }
.muted { color: var(--muted); }
.small { font-size: 0.875rem; }
.num, td, code { font-variant-numeric: tabular-nums; }
.tiles { display: flex; gap: 2.5rem; margin: 2.5rem 0 0.75rem; }
.tile .n { display: block; font-size: 2.25rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.tile .l { display: block; font-size: 0.875rem; color: var(--muted); }
.tile .n.error { color: var(--error); }
.tile .n.warning { color: var(--warning); }
ul.findings { list-style: none; padding: 0; margin: 0.5rem 0; }
.finding { margin: 0; padding: 0.75rem 0; border-bottom: 1px solid var(--line); }
.finding p { margin: 0.15rem 0; }
.pill { display: inline-block; padding: 0.05rem 0.55rem; border-radius: 999px; font-size: 0.8125rem; white-space: nowrap; }
.pill.error { color: var(--error); background: rgb(242 109 109 / 0.12); }
.pill.warning { color: var(--warning); background: rgb(232 163 61 / 0.12); }
.pill.info { color: var(--muted); background: rgb(255 255 255 / 0.06); }
@media print {
  :root { color-scheme: light; --bg: #fff; --fg: #000; --muted: #444; --line: #ccc; --error: #000; --warning: #000; }
  body { padding: 0; }
  .pill { background: none; border: 1px solid #999; color: #000; }
}
`;

const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, ' ');

function docsLink(docs: string): string {
  return /^https?:\/\//.test(docs) ? `<a href="${e(docs)}">${e(docs)}</a>` : e(docs);
}

const pill = (f: { severity: Finding['severity'] }): string => `<span class="pill ${f.severity}">${SEVERITY_NAMES[f.severity]}</span>`;
const lineText = (f: Finding): string => (f.location.line !== undefined ? ` line ${e(String(f.location.line))}` : '');

function diffList(title: string, items: Finding[]): string {
  if (!items.length) return '';
  const li = items
    .map((f) => `<li>${e(groupName(f))}: ${SEVERITY_NAMES[f.severity]} <code>${e(f.id)}</code>${lineText(f)}: ${e(oneLine(f.message))} (${e(f.engine)}: ${e(f.rule)})</li>`)
    .join('\n');
  return `<h3>${title}</h3>\n<ul>\n${li}\n</ul>\n`;
}

function repeatedBlock(g: RuleGroup): string {
  const first = (key: 'hint' | 'docs'): string | undefined => g.findings.find((f) => f[key])?.[key];
  const hint = first('hint');
  const docs = first('docs');
  let s = `<h3>${e(g.engine)}: ${e(g.rule)}</h3>\n<p>${pill(g)} ${g.findings.length} findings in ${g.files} files.</p>\n`;
  if (hint) s += `<p class="muted">Fix: ${e(oneLine(hint))}</p>\n`;
  if (docs) s += `<p class="muted">Docs: ${docsLink(oneLine(docs))}</p>\n`;
  const li = g.findings.map((f) => `<li>${e(groupName(f))}${lineText(f)}: ${e(oneLine(f.message))} <code>${e(f.id)}</code></li>`).join('\n');
  return `${s}<ul>\n${li}\n</ul>\n`;
}

export function toHtml(result: RunResult, diff?: RunDiff, since?: string): string {
  const t = result.target;
  const s = result.summary;
  const tile = (n: number, label: string, cls: string): string =>
    `<div class="tile"><span class="n${n > 0 ? ` ${cls}` : ''}">${n}</span><span class="l">${label}</span></div>`;
  const meta = [
    result.level !== undefined ? `Level ${e(levelLabel(result.level))}` : '',
    result.preset ? `Preset ${e(result.preset)}` : '',
    result.experimental ? 'Experimental checks on' : '',
    `Run ${e(runLabel(result.finishedAt))}, wp-shakedown ${e(result.tool.version)}`,
  ].filter(Boolean);
  let body = `<h1>${e(t.name)}</h1>
<p class="muted">${e(kindLabel(t.kind))} at ${e(t.path)}</p>
<p class="muted small">${meta.join(', ')}</p>
<div class="tiles">${tile(s.error, 'Critical', 'error')}${tile(s.warning, 'Important', 'warning')}${tile(s.info, 'Recommended', 'info')}</div>
${s.suppressed > 0 ? `<p class="muted small">${e(summaryLine(result))}</p>\n` : ''}`;
  if (result.engines.length === 0) {
    body += `<p>${e(noEngineLine(result))}</p>\n`;
  } else {
    // Only reports from versions that tested each theme and plugin of a WordPress folder have parts.
    const parts = result.engines.some((r) => r.unit);
    const rows = result.engines
      .map((r) => `<tr><td>${e(r.engine)}</td>${parts ? `<td>${e(r.unit ?? '-')}</td>` : ''}<td>${e(r.status)}${r.reason ? e(`: ${r.reason}`) : ''}</td><td>${e(String(r.findings))}</td></tr>`)
      .join('\n');
    body += `<h2>Engines</h2>\n<table>\n<thead><tr><th>Engine</th>${parts ? '<th>Part</th>' : ''}<th>Status</th><th>Findings</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n`;
  }

  if (diff) {
    body += `<h2>${since ? `Since the run of ${e(runLabel(since))}` : 'Since the last run'}</h2>\n<p>${diff.fixed.length} fixed, ${diff.added.length} new, ${diff.open.length} still open.</p>\n`;
    body += diffList('New:', diff.added) + diffList('Fixed:', diff.fixed);
  }

  body += '<h2>Findings</h2>\n';
  const active = result.findings.filter((f) => !f.suppressed);
  if (active.length === 0) body += '<p>No findings.</p>\n';
  const { repeated, rest } = splitRepeated(active);
  for (const g of repeated) body += repeatedBlock(g);
  const groups = new Map<string, Finding[]>();
  for (const f of rest) {
    const g = groups.get(groupName(f));
    if (g) g.push(f);
    else groups.set(groupName(f), [f]);
  }
  for (const [name, items] of groups) {
    // A list, not a table: five columns squeeze the message to a few words on a narrow window.
    const li = items
      .map((f) => {
        const where = [f.location.line !== undefined ? `Line ${e(String(f.location.line))}` : '', `${e(f.engine)}: ${e(f.rule)}`, `<code>${e(f.id)}</code>`].filter(Boolean);
        let s = `<li class="finding"><p>${pill(f)} ${e(oneLine(f.message))}</p>\n<p class="muted small">${where.join(', ')}</p>`;
        if (f.hint) s += `\n<p class="muted small">Fix: ${e(oneLine(f.hint))}</p>`;
        if (f.docs) s += `\n<p class="muted small">Docs: ${docsLink(oneLine(f.docs))}</p>`;
        return `${s}</li>`;
      })
      .join('\n');
    body += `<h3>${e(name)}</h3>\n<ul class="findings">\n${li}\n</ul>\n`;
  }

  if (result.assistant?.length) {
    body += '<h2>For an assistant</h2>\n<p>No tool can check these from the files. Give each one to an AI assistant, or run wp-shakedown assist with a preset that allows one.</p>\n';
    for (const a of result.assistant) {
      body += `<h3>${e(a.title)}</h3>\n<p>${e(oneLine(a.prompt))}</p>\n`;
      if (a.files.length) body += `<p class="muted small">Start with: ${e(a.files.join(', '))}</p>\n`;
      if (a.docs) body += `<p class="muted small">Docs: ${docsLink(oneLine(a.docs))}</p>\n`;
    }
  }

  const suppressed = result.findings.filter((f) => f.suppressed);
  if (suppressed.length) {
    const li = suppressed
      .map((f) => `<li><code>${e(f.id)}</code> ${e(f.engine)}: ${e(f.rule)}. Reason: ${e(oneLine(f.suppressed!.reason))}</li>`)
      .join('\n');
    body += `<h2>Suppressed</h2>\n<ul>\n${li}\n</ul>\n`;
  }

  if (result.staleBaseline.length) {
    const li = result.staleBaseline.map((id) => `<li><code>${e(id)}</code></li>`).join('\n');
    body += `<h2>Stale baseline entries</h2>\n<p>These baseline entries match nothing now. Remove them.</p>\n<ul>\n${li}\n</ul>\n`;
  }

  if (result.engines.length) {
    const ids = [...new Set(result.engines.map((r) => r.engine))];
    const li = ids.map((id) => `<li><code>${e(`wp-shakedown run "${t.path}" --engine ${id}`)}</code></li>`).join('\n');
    body += `<h2>Run again</h2>\n<ul>\n${li}\n</ul>\n`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wp-shakedown report: ${e(t.name)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}</body>
</html>
`;
}
