/**
 * Render docs/privacy.md into app/privacy.html.
 *
 * Both stores want a public URL for the policy, and the app is a static site,
 * so the policy has to exist as a page. Keeping the Markdown as the one source
 * and generating the page means the two cannot drift — a privacy policy that
 * disagrees with itself is worse than none.
 *
 *   node tools/make-privacy.mjs
 *
 * The Markdown subset here is exactly what that document uses: headings,
 * paragraphs, unordered lists, pipe tables, bold, inline code and links. It is
 * not a general Markdown implementation and does not pretend to be.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync(new URL('../docs/privacy.md', import.meta.url), 'utf8');

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

const out = [];
const lines = md.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (/^#{1,3} /.test(line)) {
    const level = line.match(/^#+/)[0].length;
    out.push(`<h${level}>${inline(line.replace(/^#+ /, ''))}</h${level}>`);
    continue;
  }

  if (line.startsWith('- ')) {
    const items = [];
    while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2));
    i--;
    out.push('<ul>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>');
    continue;
  }

  // A pipe table: header row, a separator of dashes, then body rows.
  if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
    const head = cells(line);
    const body = [];
    i += 2;
    while (i < lines.length && lines[i].startsWith('|')) body.push(cells(lines[i++]));
    i--;
    out.push(
      '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
      body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
      '</tbody></table>'
    );
    continue;
  }

  if (line.trim()) {
    // Markdown wraps paragraphs across lines; join until the blank one.
    const para = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^[#\-|]/.test(lines[i + 1])) para.push(lines[++i]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
}

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>개인정보 처리방침 — K-직장인 영어</title>
<!-- GENERATED FROM docs/privacy.md BY tools/make-privacy.mjs — DO NOT EDIT -->
<link rel="stylesheet" href="styles.css">
<style>
  .doc { max-width: 40rem; margin: 0 auto; padding: 32px 18px 64px; }
  .doc h1 { margin-bottom: 4px; }
  .doc h2 { margin-top: 34px; }
  .doc h3 { margin-top: 24px; }
  .doc p { margin: 0 0 13px; }
  .doc p, .doc li { color: var(--ink-2); line-height: 1.65; }
  .doc ul { padding-left: 20px; }
  .doc li { margin-bottom: 6px; }
  .doc table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 14px; }
  .doc th, .doc td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .doc th { color: var(--muted); font-weight: 600; }
  .doc code { font-family: var(--mono); font-size: .92em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
  .doc a { color: var(--accent); }
  .back { display: inline-block; margin-top: 40px; color: var(--muted); font-size: 13.5px; }
</style>
</head>
<body>
<main class="doc">
${out.join('\n')}
<a class="back" href="index.html">← 앱으로 돌아가기</a>
</main>
</body>
</html>
`;

const dest = new URL('../app/privacy.html', import.meta.url);
writeFileSync(dest, html);
console.log(`wrote app/privacy.html (${html.length} bytes)`);
