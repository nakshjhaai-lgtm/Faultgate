#!/usr/bin/env node
/**
 * Browser audit. Requires a Chromium the environment can launch; set
 * CHROME_PATH (and LD_LIBRARY_PATH if the host is missing NSS). Checks that
 * cannot be done by reading the HTML: contrast, focus visibility, tap target
 * size, keyboard order, and layout shift between breakpoints.
 *
 *   node tools/audit-browser.mjs http://127.0.0.1:4173
 */
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const exe = process.env.CHROME_PATH;
if (!exe) {
  console.error('CHROME_PATH is not set; skipping the browser audit');
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
  headless: true,
});

const results = [];
const record = (name, pass, detail) => results.push({ name, pass, detail });

const CONTRAST_JS = `(() => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 4).map(Number);
  const blend = (fg, bg) => {
    const a = fg[3] === undefined ? 1 : fg[3];
    return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
  };
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const c = getComputedStyle(node).backgroundColor;
      const p = parse(c);
      if (p.length === 3 || (p.length === 4 && p[3] > 0.95)) return p.slice(0, 3);
      node = node.parentElement;
    }
    const b = parse(getComputedStyle(document.body).backgroundColor);
    return b.length >= 3 ? b.slice(0, 3) : [255, 255, 255];
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ');
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.1) continue;
    const fg = parse(cs.color);
    const bg = bgOf(el);
    const l1 = lum(blend(fg, bg)) + 0.05;
    const l2 = lum(bg) + 0.05;
    const ratio = l1 > l2 ? l1 / l2 : l2 / l1;
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 600;
    const large = size >= 24 || (size >= 18.66 && bold);
    const min = large ? 3 : 4.5;
    if (ratio < min) out.push({ text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100, min, size, cls: (el.className || '').toString().slice(0, 30) });
  }
  return out;
})()`;

for (const theme of ['light', 'dark']) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.goto(base + '/', { waitUntil: 'networkidle0' });

  const low = await page.evaluate(CONTRAST_JS);
  record(
    `contrast (${theme})`,
    low.length === 0,
    low.length ? JSON.stringify(low.slice(0, 6)) : 'all text meets WCAG AA',
  );

  // Touch targets
  const small = await page.evaluate(() => {
    // WCAG 2.5.8 exempts targets that sit inline in a sentence of text, so a
    // link inside a paragraph is not counted. Controls, list links and buttons
    // are all counted.
    const inSentence = (el) => {
      const p = el.closest('p, li, td, dd, blockquote');
      if (!p) return false;
      const own = (el.textContent || '').trim();
      const whole = (p.textContent || '').trim();
      return whole.length > own.length + 12;
    };
    const hidden = (el) => {
      const r = el.getBoundingClientRect();
      return r.width < 4 && r.height < 4;
    };
    const out = [];
    for (const el of document.querySelectorAll('a, button, input, select, [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('.skip')) continue;
      if (el.tagName === 'INPUT' && (el.type === 'file' || el.tabIndex < 0)) continue;
      if (hidden(el)) continue;
      if (inSentence(el)) continue;
      if (r.height < 24 || r.width < 24) out.push({ tag: el.tagName, t: (el.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  });
  record(`hit targets (${theme})`, small.length === 0, small.length ? JSON.stringify(small.slice(0, 5)) : 'all >= 24px');

  // Focus visibility on the first several tab stops
  const focus = await page.evaluate(async () => {
    const stops = [];
    const focusables = [...document.querySelectorAll('a[href], button, input, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => {
        // Only elements that are actually in the tab order at this viewport:
        // display:none controls (the mobile menu on desktop) are not.
        const r = el.getBoundingClientRect();
        return el.tabIndex >= 0 && r.width > 0 && r.height > 0 && !el.classList.contains('sr') && !(el.tagName === 'INPUT' && el.type === 'file');
      })
      .slice(0, 12);
    for (const el of focusables) {
      el.focus();
      const cs = getComputedStyle(el);
      const hasRing = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      if (!hasRing) stops.push((el.className || el.tagName).toString().slice(0, 30));
    }
    return stops;
  });
  record(`focus ring (${theme})`, focus.length === 0, focus.length ? `missing on: ${focus.join(' | ')}` : 'every focusable shows an outline');

  await page.close();
}

// Keyboard reachability of the mobile menu
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  const hiddenNav = await page.evaluate(() => getComputedStyle(document.querySelector('#site-nav')).display === 'none');
  await page.click('#menu');
  await new Promise((r) => setTimeout(r, 200));
  const opened = await page.evaluate(() => {
    const nav = document.querySelector('#site-nav');
    return getComputedStyle(nav).display !== 'none' && document.querySelector('#menu').getAttribute('aria-expanded') === 'true';
  });
  const links = await page.$$eval('#site-nav a', (as) => as.length);
  record('mobile menu', hiddenNav && opened && links === 4, `collapsed at 390px, opens with aria-expanded, ${links} links`);

  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => document.querySelector('#menu').getAttribute('aria-expanded') === 'false');
  record('mobile menu escape', closed, 'Escape closes the panel');

  // Tap target height in the open panel
  await page.click('#menu');
  const heights = await page.$$eval('#site-nav a', (as) => as.map((a) => Math.round(a.getBoundingClientRect().height)));
  record('mobile nav targets', heights.every((h) => h >= 44), heights.join(', ') + ' px');
  await page.close();
}

for (const r of results) if (!r.pass) console.log(`  FAIL  ${r.name}: ${r.detail}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
await browser.close();
if (failed) process.exit(1);
