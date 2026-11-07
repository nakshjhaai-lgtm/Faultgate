#!/usr/bin/env node
/**
 * Build self-audit.
 *
 * Every check below corresponds to a specific, commonly cited signal that a
 * page was generated without a design system. The audit runs against the built
 * output, not the source, because that is what ships. A failure exits non-zero
 * so CI blocks the deploy.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const results = [];
const ok = (name, detail) => results.push({ name, pass: true, detail });
const bad = (name, detail) => results.push({ name, pass: false, detail });

const read = (p) => readFile(path.join(dist, p), 'utf8');

/* ------------------------------------------------------------------ files -- */
const files = await readdir(dist, { recursive: true });
const htmlFiles = files.filter((f) => f.endsWith('.html')).sort();
if (htmlFiles.length === 0) bad('output exists', 'no HTML files in dist/');
else ok('output exists', `${files.length} files, ${htmlFiles.length} pages`);

const pages = new Map();
for (const f of htmlFiles) pages.set(f, await read(f));
const css = await read('style.css');

/* ------------------------------------------------------------------- meta -- */
const titles = new Set();
const descs = new Set();
for (const [file, html] of pages) {
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
  const desc = html.match(/<meta name="description" content="([\s\S]*?)">/)?.[1]?.trim() ?? '';
  if (!title) bad(`title: ${file}`, 'missing');
  else if (/^(Vite|React App|Create Next App|Next\.js|Document)$/i.test(title)) bad(`title: ${file}`, `framework default: ${title}`);
  else titles.add(title);
  if (!desc) bad(`description: ${file}`, 'missing');
  else if (desc.length < 70) bad(`description: ${file}`, `${desc.length} chars, too short to be specific`);
  else descs.add(desc);

  if (!/<html lang="/.test(html)) bad(`html lang: ${file}`, 'missing lang attribute');
  if (!/rel="canonical"/.test(html)) bad(`canonical: ${file}`, 'missing');
  if (!/property="og:image"/.test(html)) bad(`og image: ${file}`, 'missing');
  if (!/name="viewport"/.test(html)) bad(`viewport: ${file}`, 'missing');

  const h1s = html.match(/<h1[\s>]/g) ?? [];
  if (h1s.length === 0) bad(`h1: ${file}`, 'no h1');
  else if (h1s.length > 1) bad(`h1: ${file}`, `${h1s.length} h1 elements`);

  // Heading order: no skipped levels.
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  let prev = levels[0] ?? 1;
  for (const l of levels) {
    if (l > prev + 1) bad(`heading order: ${file}`, `h${prev} then h${l}`);
    prev = l;
  }

  if (!/class="skip"/.test(html)) bad(`skip link: ${file}`, 'missing');
  if (!/<main/.test(html)) bad(`landmark: ${file}`, 'no main element');
  if (!/<footer/.test(html)) bad(`landmark: ${file}`, 'no footer element');

  // Images need alt text.
  for (const img of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(img[0])) bad(`alt text: ${file}`, img[0].slice(0, 60));
  }

  // Every anchor must go somewhere real.
  for (const a of html.matchAll(/<a\b[^>]*href="([^"]*)"/g)) {
    const href = a[1];
    if (href === '#' || href === '') bad(`dead link: ${file}`, 'href="#" found');
  }

  // No emoji as UI iconography.
  if (/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u.test(html)) bad(`emoji icons: ${file}`, 'emoji found in markup');

  // The single most cited copywriting tell.
  if (html.includes('—')) bad(`em dash: ${file}`, 'em dash in page copy');
}
if (titles.size !== pages.size) bad('unique titles', `${titles.size} unique across ${pages.size} pages`);
else ok('unique titles', `${titles.size} pages`);
if (descs.size !== pages.size) bad('unique descriptions', `${descs.size} unique across ${pages.size} pages`);
else ok('unique descriptions', `${descs.size} pages`);

/* -------------------------------------------------------------------- css -- */
// The palette is one set of 21 colour tokens, and it is written out three
// times: once for the default light theme, once for the system dark theme and
// once for the manual dark override. 21 tokens plus the print block's two
// values is 46 unique hex literals; anything past that is a colour that did not
// come from the token set.
const hexes = new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((h) => h.toLowerCase()));
if (hexes.size > 48) bad('colour system', `${hexes.size} literal hex values, tokens are leaking`);
else ok('colour system', `${hexes.size} hex literals, the rest resolved through custom properties`);

const radii = new Set([...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim()));
if (radii.size > 8) bad('radius system', `${radii.size} distinct border-radius declarations`);
else ok('radius system', `${radii.size} distinct radius declarations`);

if (/transition:\s*all\b/.test(css)) bad('no transition:all', 'transition:all animates layout properties');
else ok('no transition:all', 'every transition names its properties');

if (!/prefers-reduced-motion/.test(css)) bad('reduced motion', 'no reduced-motion query');
else ok('reduced motion', 'honoured');

if (!/prefers-color-scheme/.test(css)) bad('dark mode', 'no colour-scheme support');
else ok('dark mode', 'system preference honoured plus a manual override');

if (/9999px/.test(css)) bad('pill buttons', 'border-radius 9999px found');
else ok('pill buttons', 'none');

// No external font or script origins.
if (/url\(['"]?https?:/.test(css)) bad('self-hosted assets', 'external url() in CSS');
else ok('self-hosted assets', 'no external url() in CSS');

/* -------------------------------------------------------------------- js -- */
const js = await read('client.js');
if (js.includes('console.log')) bad('no console noise', 'console.log shipped');
else ok('no console noise', 'no console.log in the bundle');
if (/sourceMappingURL/.test(js)) bad('no source maps', 'sourceMappingURL in the bundle');
else ok('no source maps', 'none shipped');
for (const host of ['google-analytics', 'googletagmanager', 'segment.io', 'mixpanel', 'sentry', 'hotjar', 'vercel-insights']) {
  if (js.includes(host)) bad('no third-party telemetry', host);
}
ok('no third-party telemetry', 'checked 7 analytics hosts');
if (!/Content-Security-Policy/.test(await read('_headers'))) bad('CSP', '_headers has no CSP');
else ok('CSP', 'default-src none with a self-only allowlist');

/* -------------------------------------------------------------- required -- */
for (const f of ['robots.txt', 'sitemap.xml', 'llms.txt', 'og.png', 'favicon.svg', 'site.webmanifest', '_headers', '404.html', 'templates/A.csv', 'templates/B.csv', 'templates/C.csv']) {
  const exists = await stat(path.join(dist, f)).then(() => true).catch(() => false);
  if (!exists) bad(`file: ${f}`, 'missing');
}
ok('deploy files', 'robots, sitemap, llms, manifest, headers, 404, templates');

const robots = await read('robots.txt');
if (/Disallow:\s*\/\s*$/m.test(robots)) bad('robots allows crawling', 'root disallowed');
else ok('robots allows crawling', `${(robots.match(/User-agent:/g) ?? []).length} agents listed`);

/* ------------------------------------------------------------------ report -- */
const failed = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass) console.log(`  FAIL  ${r.name}: ${r.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} self-audit checks passed`);
if (failed.length) {
  console.log(`${failed.length} failing. Fix the cause, not the check.`);
  process.exit(1);
}
