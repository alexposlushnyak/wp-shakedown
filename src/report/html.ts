import type { Finding, RunDiff, RunResult } from '../types.ts';
import { escapeHtml as e } from './escape.ts';
import { groupName, noEngineLine, summaryLine } from './markdown.ts';

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1d2327; --muted: #646970; --line: #dcdcde; --accent: #2271b1; }
@media (prefers-color-scheme: dark) { :root { --bg: #14181c; --fg: #e4e7ea; --muted: #9aa3ab; --line: #333a41; --accent: #72aee6; } }
body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
h1, h2, h3 { line-height: 1.25; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { text-align: left; vertical-align: top; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--line); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
a { color: var(--accent); }
.muted { color: var(--muted); }
`;

const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, ' ');

function docsLink(docs: string): string {
  return /^https?:\/\//.test(docs) ? `<a href="${e(docs)}">${e(docs)}</a>` : e(docs);
}

function diffList(title: string, items: Finding[]): string {
  if (!items.length) return '';
  const li = items
    .map((f) => `<li>${e(groupName(f))}: ${e(f.severity)} <code>${e(f.id)}</code>${f.location.line !== undefined ? ` line ${e(String(f.location.line))}` : ''}: ${e(oneLine(f.message))} (${e(f.engine)}: ${e(f.rule)})</li>`)
    .join('\n');
  return `<h3>${title}</h3>\n<ul>\n${li}\n</ul>\n`;
}

export function toHtml(result: RunResult, diff?: RunDiff): string {
  const t = result.target;
  let body = `<h1>wp-shakedown report</h1>
<p>Target: ${e(t.kind)} "${e(t.name)}" at ${e(t.path)}<br>
${result.profile ? `Profile: ${e(result.profile)}<br>\n` : ''}Run: ${e(result.finishedAt)}, wp-shakedown ${e(result.tool.version)}</p>
<h2>Summary</h2>
<p>${e(summaryLine(result))}</p>
`;
  if (result.engines.length === 0) {
    body += `<p>${e(noEngineLine(result))}</p>\n`;
  } else {
    const rows = result.engines
      .map((r) => `<tr><td>${e(r.engine)}</td><td>${e(r.unit ?? '-')}</td><td>${e(r.status)}${r.reason ? e(`: ${r.reason}`) : ''}</td><td>${e(String(r.findings))}</td></tr>`)
      .join('\n');
    body += `<table>\n<thead><tr><th>Engine</th><th>Part</th><th>Status</th><th>Findings</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n`;
  }

  if (diff) {
    body += `<h2>Since the last run</h2>\n<p>${diff.fixed.length} fixed, ${diff.added.length} new, ${diff.open.length} still open.</p>\n`;
    body += diffList('New:', diff.added) + diffList('Fixed:', diff.fixed);
  }

  body += '<h2>Findings</h2>\n';
  const active = result.findings.filter((f) => !f.suppressed);
  if (active.length === 0) body += '<p>No findings.</p>\n';
  const groups = new Map<string, Finding[]>();
  for (const f of active) {
    const g = groups.get(groupName(f));
    if (g) g.push(f);
    else groups.set(groupName(f), [f]);
  }
  for (const [name, items] of groups) {
    const rows = items
      .map((f) => {
        let msg = e(oneLine(f.message));
        if (f.hint) msg += `<br><span class="muted">Fix: ${e(oneLine(f.hint))}</span>`;
        if (f.docs) msg += `<br><span class="muted">Docs: ${docsLink(oneLine(f.docs))}</span>`;
        return `<tr><td>${e(f.severity)}</td><td><code>${e(f.id)}</code></td><td>${e(String(f.location.line ?? ''))}</td><td>${msg}</td><td>${e(f.engine)}: ${e(f.rule)}</td></tr>`;
      })
      .join('\n');
    body += `<h3>${e(name)}</h3>\n<table>\n<thead><tr><th>Severity</th><th>ID</th><th>Line</th><th>Message</th><th>Rule</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n`;
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
