#!/usr/bin/env node
/**
 * Static build. Emits a fully prerendered dist/ with:
 *  - index.html        the verifier (all content in the HTML, JS only enhances)
 *  - how-it-works.html method and limits
 *  - docs.html         table schema, guard grammar, worked examples
 *  - background.html   the failure evidence this tool exists for
 *  - privacy.html
 *  - 404.html
 *  - templates/*.csv   the three reference tables as spreadsheets
 *  - robots.txt, sitemap.xml, llms.txt, _headers, site.webmanifest, favicon.svg, og.png
 *
 * No framework, no runtime dependencies in the output. The only script is a
 * single ES module produced by esbuild.
 */
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL as pathToFileUrl } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const SITE = 'https://faultgate.pages.dev';
const TITLE = 'FaultGate · cross-subsystem FDIR and command-boundary verifier';
const DESCRIPTION =
  'FaultGate checks host vehicle bus fault-protection tables against payload and autonomy command envelopes in the browser. No install, no login, no upload. It flags the cross-vendor states where both ICDs are individually satisfied and the vehicle is still unrecoverable, and exports the guard patch for each one.';
const YEAR = 2026;
const AUTHOR = 'Anukalp Jha';

/* ------------------------------------------------------------------ data -- */
// Compile the shared TypeScript (templates + engine + codec) once, then import
// the bundle. This keeps the build free of a TS loader at runtime.
const sharedBundle = path.join(root, '.build/shared.mjs');
await build({
  entryPoints: [path.join(root, 'tools/shared-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  outfile: sharedBundle,
  logLevel: 'silent',
});
const shared = await import(pathToFileUrl(sharedBundle).href);
const { tableToCsv, runCheck } = shared;
const templates = shared.templates;
const templateA = templates.A;
const templateB = templates.B;
const templateC = templates.C;

/* ------------------------------------------------------------------ html -- */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const NAV = [
  ['/', 'Verifier'],
  ['/how-it-works.html', 'Method'],
  ['/docs.html', 'Schema'],
  ['/background.html', 'Background'],
];

const brand = `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false"><rect x="1" y="1" width="20" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 7h5v5H5z" fill="currentColor"/><path d="M12 10h5M12 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 15h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

function layout({ slug, title, description, body, bodyClass = '', schema = null }) {
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === slug ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${slug}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0d5c63">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FaultGate">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${slug}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="FaultGate: a cross-subsystem boundary check that returns BLOCKED with three traceable conflicts.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/favicon.svg">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/fonts/archivo-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/archivo-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ''}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="shell site-head__inner">
    <a class="brand" href="/" aria-label="FaultGate home">${brand}<span translate="no">FaultGate</span></a>
    <nav class="nav" id="site-nav" aria-label="Primary">
      ${nav}
    </nav>
    <div class="head-tools">
      <button class="theme-toggle" id="theme" type="button" aria-label="Colour theme: follow system. Activate to change.">
        <span class="theme-toggle__text">Auto</span>
      </button>
      <button class="menu-btn" id="menu" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Open menu">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path class="menu-btn__open" d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          <path class="menu-btn__close" d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>
</header>
${body}
<footer class="site-foot">
  <div class="shell">
    <div class="site-foot__grid">
      <div>
        <h2>FaultGate</h2>
        <p class="foot-copy">A boundary verifier for teams that bolt third-party autonomy onto a third-party bus. Runs in the browser, exports a patch sheet, keeps no copy of your table.</p>
      </div>
      <div>
        <h2>Tool</h2>
        <ul>
          <li><a href="/">Boundary check</a></li>
          <li><a href="/docs.html">Table schema</a></li>
          <li><a href="/templates/A.csv">Template A (.csv)</a></li>
          <li><a href="/templates/B.csv">Template B (.csv)</a></li>
          <li><a href="/templates/C.csv">Template C (.csv)</a></li>
        </ul>
      </div>
      <div>
        <h2>Reading</h2>
        <ul>
          <li><a href="/how-it-works.html">What the check proves</a></li>
          <li><a href="/how-it-works.html#limits">Limits and falsifier</a></li>
          <li><a href="/background.html">Why this exists</a></li>
          <li><a href="/background.html#evidence">Evidence log</a></li>
        </ul>
      </div>
      <div>
        <h2>Contact</h2>
        <ul>
          <li><a href="https://github.com/nakshjhaai-lgtm/Faultgate/issues">Open an issue</a></li>
          <li><a href="/llms.txt">llms.txt</a></li>
          <li><a href="/privacy.html">Privacy</a></li>
        </ul>
      </div>
    </div>
    <div class="site-foot__base">
      <span>© ${YEAR} ${AUTHOR}</span>
      <span>No analytics, no cookies, no accounts</span>
      <span>Revision ${pkg.version}</span>
    </div>
  </div>
</footer>
<script type="module" src="/client.js"></script>
</body>
</html>
`;
}

/* --------------------------------------------------------------- index --- */
const templateCards = Object.entries(templates)
  .map(
    ([id, t]) => `
    <button type="button" class="tpl" data-tpl="${id}" aria-pressed="${id === 'A' ? 'true' : 'false'}">
      <span class="tpl__id">Template ${id}</span>
      <span class="tpl__name">${esc(t.name)}</span>
      <span class="tpl__sum">${esc(t.summary)}</span>
      <span class="tpl__counts">${t.subsystems.reduce((n, s) => n + s.states.length, 0)} states / ${t.subsystems.reduce((n, s) => n + s.transitions.length, 0)} transitions / ${t.faults.length} faults / ${t.boundary.length} rules</span>
    </button>`,
  )
  .join('');

const preRunA = runCheck(templateA, { maxFaultDepth: 3 });
const preRunB = runCheck(templateB, { maxFaultDepth: 3 });
const preRunC = runCheck(templateC, { maxFaultDepth: 3 });

const indexBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <p class="eyebrow">Cross-subsystem FDIR verifier</p>
      <h1>Two ICDs, each correct. One vehicle that cannot recover.</h1>
      <p>FaultGate reads the host bus fault-protection table and the payload or autonomy command envelope as one state machine, injects every fault combination up to three at once, and names each reachable state where the two documents disagree. It runs here in your browser on your own machine: the table is never uploaded, there is nothing to install and nothing to sign in to.</p>
      <div class="hero__meta">
        <span><b>${preRunA.findings.length}</b> conflicts in template A</span>
        <span><b>${preRunB.findings.length}</b> in B</span>
        <span><b>${preRunC.findings.length}</b> in C</span>
        <span><b>${shared.formatDuration(Math.max(preRunA.durationMs, preRunB.durationMs, preRunC.durationMs))}</b> per check</span>
        <span><b>0 bytes</b> leave the page</span>
      </div>
    </section>

    <section class="steps" aria-labelledby="steps-title">
      <h2 id="steps-title">Three steps, no setup</h2>
      <ol>
        <li><span><strong>Pick a table</strong>Choose one of the three reference tables below, or drop your own bus and payload CSV or JSON.</span></li>
        <li><span><strong>Run the boundary check</strong>Every single fault, fault pair and fault triple is injected, then the reachable state space is explored across both subsystems.</span></li>
        <li><span><strong>Export the guard patch</strong>Each conflict comes with a reproduction trace and the interface condition that removes it, as Markdown or CSV.</span></li>
      </ol>
    </section>

    <section aria-labelledby="pick-title" class="stack">
      <h2 id="pick-title" class="sr">Choose a fault table</h2>
      <div class="picker" id="picker">${templateCards}</div>
      <div id="chosen" aria-live="polite"></div>

      <div class="drop" id="drop">
        <p><strong>Drop a fault table here</strong> or choose a file. CSV or JSON, one record per row, 2&nbsp;MB limit. Nothing is transmitted: the file is read with the browser File API and stays in this tab.</p>
        <div class="drop__row">
          <button type="button" class="btn btn--ghost" id="browse">Choose file</button>
          <button type="button" class="btn btn--ghost" id="download-sample">Download this template as CSV</button>
          <input type="file" id="file" accept=".csv,.json,text/csv,application/json" class="sr" tabindex="-1" aria-label="Fault table file">
        </div>
        <p class="note" class="pad-top-sm">Columns, guard grammar and a two-record example are on the <a href="/docs.html">schema page</a>.</p>
      </div>

      <div id="error" class="hide" aria-live="assertive"></div>

      <div class="btn-row" class="pad-top">
        <button type="button" class="btn btn--primary" id="run">
          <span class="spin" aria-hidden="true"></span>
          <span class="btn__label">Run boundary check</span>
        </button>
        <span class="note">Runs locally. Shortcut: <kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>Enter</kbd></span>
      </div>
    </section>

    <section id="result" class="prose" class="no-border prose--result" aria-live="polite">
${shared.renderResult(templateA, preRunA)}
    </section>
  </div>
</main>
`;

/* --------------------------------------------------------- how it works -- */
const MECHANISM = [
  ['One state machine, not two', 'The bus FDIR table and the payload command envelope are compiled into a single transition system. A transition in either subsystem is guarded by the other subsystem\'s state, which is exactly where interface requirements live and exactly where a per-ICD review cannot see them.'],
  ['Faults are held, not sampled', 'Each fault asserts a flag for the whole exploration: under-voltage present, watchdog expired, uplink unavailable. Single faults and every pair are run separately, so a conflict that needs two simultaneous failures is reported with both named.'],
  ['Reachability, not a checklist', 'The search is a breadth-first walk from the commissioning seed state. A rule only becomes a finding if some ordered sequence of legal transitions reaches it. A rule that looks alarming but is unreachable is reported as clean, and the sheet says so.'],
  ['Shortest trace to the failure', 'Breadth-first order means the trace printed for each conflict is the shortest reproduction. That is what makes the finding arguable in a review: it can be replayed by hand in the ICD.'],
  ['Absorbing states are reported too', 'A reachable state with no enabled transition in either subsystem can only be left by a hardware reset. On a spacecraft that is not available, so these are listed separately from rule violations.'],
];

const LIMITS = [
  ['Model, not hardware', 'The result is only as complete as the transitions and faults you entered. Interlocks implemented in analog circuitry, in an FPGA bitstream, or in a firmware path missing from the table are outside the model and will not be reported.'],
  ['Held faults only', 'Faults are assumed to persist for the whole run. Transient pulses shorter than a control period are not modelled, which can hide a conflict that only appears on a rising edge.'],
  ['Two subsystems', 'The current schema models one bus plus one controller. A three-way conflict between bus, payload and ground segment has to be reduced to two before it can be entered.'],
  ['No timing', 'Transitions are ordered but not timed. A conflict that requires two events within 10 ms of each other is reported if the order is possible, even if the real timing margin is comfortable.'],
  ['A clear result is not flight clearance', 'It means no rule fired for this table. Sign-off still belongs to the systems engineer who owns the interface, which is why every export carries the table revision, the fault set and the trace.'],
];

const howBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <p class="eyebrow">Method</p>
      <h1>What the check actually proves</h1>
      <p>A verifier is only useful if its guarantees are stated narrowly enough to be true. FaultGate answers one question: given these two tables and these faults, is any cross-subsystem state reachable where an interface rule is broken? Everything below is the mechanism, then the limits.</p>
    </section>

    <section class="prose" aria-labelledby="mech">
      <h2 id="mech">Mechanism</h2>
      <dl class="deflist">
        ${MECHANISM.map(([t, d], i) => `<div><dt>${String(i + 1).padStart(2, '0')} · ${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}
      </dl>
    </section>

    <section class="prose" id="limits" aria-labelledby="limits-t">
      <h2 id="limits-t">Limits, stated plainly</h2>
      <p>These are the ways a clear result can mislead you. They are on this page rather than in a footnote because a verifier that hides its own blind spots is worse than no verifier.</p>
      <dl class="deflist">
        ${LIMITS.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}
      </dl>
    </section>

    <section class="prose" aria-labelledby="fals">
      <h2 id="fals">What would show this tool is unnecessary</h2>
      <p>The premise is that cross-vendor FDIR boundary conflicts are a live failure mode, not a theoretical one. Two observations would falsify it: flight telemetry showing that the overwhelming majority of commissioning aborts trace to mechanical or structural failure with no software state transition involved, or evidence that teams already run a formal cross-vendor reachability check before flight lock.</p>
      <p>If the second becomes true, FaultGate should be retired. If the first is true for your programme, the fault table on your desk should be about structures instead.</p>
    </section>

    <section class="prose no-border" aria-labelledby="time">
      <h2 id="time">On the time claim</h2>
      <p>A boundary audit done by hand means reading two ICDs side by side, listing every pair of states that can coexist, and checking each pair against the interface requirements. For a table the size of the templates here that is roughly a working day, and it is the first task cut when a launch date moves.</p>
      <p>The enumeration is the slow part, and it is the part a machine can do. On the three reference tables FaultGate evaluates 93, 26 and 26 fault combinations in under a second, and the sheet it produces is then reviewed rather than drafted. That is the basis for the working figure of 30 minutes to review an exported patch sheet against an 8-hour manual pass: 7.5 hours saved per integration review, roughly 16 times faster.</p>
      <p>Treat that as an estimate about this class of table, not a measurement of your programme. It assumes the tables you feed in are already maintained and that the review only has to confirm findings the tool has located and traced. If the tables are not maintained, fixing that comes first.</p>
      <p><a href="/">Run it on the reference tables</a> and read the traces before trusting the summary.</p>
    </section>
  </div>
</main>
`;

/* ------------------------------------------------------------- docs ----- */
const docsBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <p class="eyebrow">Schema</p>
      <h1>The table format</h1>
      <p>A fault table is five record types in one CSV, or the same structure as JSON. It is designed to be produced from the spreadsheet your FDIR review already uses: one row per state, one row per transition, one row per injected fault, one row per interface rule.</p>
    </section>

    <section class="prose" aria-labelledby="records">
      <h2 id="records">Records</h2>
      <dl class="deflist">
        <div><dt>meta</dt><dd>Table name, revision and provenance. Provenance is printed in every export, so a patch sheet can be traced back to the ICD revision it was computed from. Columns: <code>label</code> (name), <code>ref</code> (revision), <code>guard_patch</code> (provenance), <code>match</code> (one-line summary).</dd></div>
        <div><dt>subsystem</dt><dd><code>subsystem</code> is the id used by guards, <code>vendor</code> is the display name, <code>role</code> is bus, payload or controller, <code>initial</code> is the seed state.</dd></div>
        <div><dt>state</dt><dd><code>subsystem</code>, <code>state</code>, <code>label</code>. Put <code>terminal</code> in <code>effects</code> to mark an absorbing state, or <code>safe</code> for an intended-safe state.</dd></div>
        <div><dt>transition</dt><dd><code>subsystem</code>, <code>from_state</code>, <code>to_state</code>, <code>guard</code>, <code>effects</code>, <code>label</code>, <code>ref</code>. Effects are <code>+flag</code> to set and <code>-flag</code> to clear, comma separated.</dd></div>
        <div><dt>fault</dt><dd><code>id</code>, <code>label</code>, <code>asserts</code>, <code>clears</code>, <code>ref</code>. Each fault is held for a whole exploration and paired with every other fault.</dd></div>
        <div><dt>rule</dt><dd><code>id</code>, <code>label</code>, <code>severity</code> (critical, major, minor), <code>match</code> (the guard that must never be true), <code>guard_patch</code> (the remedy, printed verbatim in the export), <code>ref</code>.</dd></div>
      </dl>
    </section>

    <section class="prose" aria-labelledby="grammar">
      <h2 id="grammar">Guard grammar</h2>
      <p>Guards are prefix expressions so they stay typeable in a spreadsheet cell. Keywords are case-insensitive.</p>
      <ul>
        <li><code>always()</code>: unconditionally true.</li>
        <li><code>flag(bus.uv_trip)</code>: true when the flag is asserted. Flags are strings; dots are conventional, not structural.</li>
        <li><code>state(bus.RADIO_OFF)</code>: true when that subsystem is in that state. This is the operator that makes the check cross-subsystem.</li>
        <li><code>NOT</code>, <code>AND</code>, <code>OR</code> and parentheses, in that precedence order.</li>
      </ul>
      <p>Example: <code>state(bus.RADIO_OFF) AND NOT flag(watchdog.enabled) AND NOT flag(ground.uplink)</code> reads as “the radio is latched off, there is no restore timer, and no uplink is coming”.</p>
    </section>

    <section class="prose" aria-labelledby="example">
      <h2 id="example">A two-transition example</h2>
      <p>This is the shape of the failure in template A, reduced to four rows. The bus drops the radio on an under-voltage trip; the payload kernel has no command path without the radio and latches.</p>
      <pre class="trace"><code>record,subsystem,vendor,role,initial,state,label,from_state,to_state,guard,effects,ref,id,severity,match,guard_patch,asserts,clears
meta,FaultGate example,r3,,,Commissioning radio cutoff,,,,,,,,,
subsystem,bus,Host bus FDIR,bus,COMMISSIONING,,,,,,,,,,,
state,bus,,,RADIO_ON,Radio on,,,,,,,,,,
state,bus,,,RADIO_OFF,Radio off,,,,,,,,,,
transition,bus,,,,,Under-voltage trip removes the radio,RADIO_ON,RADIO_OFF,flag(bus.uv_trip),-radio.enabled,BUS-FDIR-14,,,,,
subsystem,payload,Autonomy kernel,payload,KERNEL_IDLE,,,,,,,,,,,
state,payload,,,STANDBY,Standby,,,,,,,,,,
state,payload,,,LOCKOUT,Lockout,,,,,,,,,,
transition,payload,,,,,No command path without the radio,STANDBY,LOCKOUT,state(bus.RADIO_OFF),+kernel.lockout,PAY-SK-18,,,,,
fault,F1,Bus under-voltage trip,,,,,,,,,,,bus.uv_trip,
rule,BG-01,Radio latched off with no restore path,,,,,,,,critical,state(payload.LOCKOUT),Arm the radio restore watchdog,,,</code></pre>
      <p class="note">Download a complete file instead: <a href="/templates/A.csv">template A</a>, <a href="/templates/B.csv">template B</a>, <a href="/templates/C.csv">template C</a>. All three round-trip through the importer unchanged.</p>
    </section>

    <section class="prose" class="no-border" aria-labelledby="json">
      <h2 id="json">JSON form</h2>
      <p>The JSON form is the same five record types with the same field names, as objects. Guards become expression trees:</p>
      <pre class="trace"><code>{
  "name": "Orbital bus and autonomy kernel",
  "revision": "A-2026.11-r3",
  "provenance": "icd rev C, FDIR table rev 14",
  "subsystems": [
    { "id": "bus", "role": "bus", "vendor": "Host bus", "initial": "COMMISSIONING",
      "states": [{ "id": "RADIO_ON", "label": "Radio on" }],
      "transitions": [{ "from": "RADIO_ON", "to": "RADIO_OFF",
        "guard": { "flag": "bus.uv_trip" }, "effects": [{ "kind": "clear", "flag": "radio.enabled" }],
        "label": "Under-voltage trip removes the radio" }] }
  ],
  "faults": [{ "id": "F1", "label": "Under-voltage trip", "asserts": ["bus.uv_trip"], "clears": [] }],
  "boundary": [{ "id": "BG-01", "label": "Radio off, no restore", "severity": "critical",
    "match": { "state": "bus.RADIO_OFF" }, "guardPatch": "Arm the restore watchdog." }]
}</code></pre>
      <p>Guard nodes are <code>{"flag": "name"}</code>, <code>{"state": "sub.STATE"}</code>, <code>{"not": g}</code>, <code>{"and": [g...]}</code>, <code>{"or": [g...]}</code> and <code>{"always": true}</code>.</p>
    </section>
  </div>
</main>
`;

/* --------------------------------------------------------- background --- */
const evidenceRows = [
  ['Otter 24C', 'Starfish Space', '2026-11-04', 'Contact lost on the NASA SSPICY inspection mission after a third-party bus fault-protection action removed the radio during commissioning.', 'https://payloadspace.com/starfish-loses-contact-with-otter-cutting-sspicy-short/'],
  ['Replicator 2', 'Orbital Matter / EnduroSat', '2026-11-04', 'First orbital print attempt failed on a third-party bus; two months of ground testing and a firmware patch were needed before a 32.5 cm boom printed in vacuum.', 'https://payloadspace.com/orbital-matter-endurosat-announce-an-in-space-manufacturing-mission-in-2028/'],
  ['Astraeus', 'Orbital Operations', '2026-10-23', 'Up-to-$35M DoD prototype award for a cryogenic spacecraft, where thermal-management fault rules must not conflict with burn preparation.', 'https://payloadspace.com/exclusive-dod-taps-orbital-operations-for-cryogenic-spacecraft-demo/'],
  ['Big Iron', 'Cowboy Space', '2026-10-26', 'An 86-metre rocket whose upper stage stays in orbit as a GPU data centre, sharing radiator and coolant plumbing with ascent fault rules.', 'https://payloadspace.com/cowboy-space-reveals-big-iron-data-center-rocket/'],
  ['Starburst-1', 'Portal Space Systems', '2026-10-23', 'Orbital checkout complete on a bus designed to fly multi-vendor third-party payloads, then activate ammonia propulsion.', 'https://payloadspace.com/portal-space-systems-completes-starburst-1-checkout/'],
  ['Orca OS', 'Orca Aerospace / Orbital', '2026-11-05', 'Up-to-$20M deal to layer an onboard AI planner, command translator and deterministic safety kernel onto a third-party bus.', 'https://payloadspace.com/exclusive-orbital-taps-orca-aerospace-for-onboard-autonomy-software/'],
];

const backgroundBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <p class="eyebrow">Background</p>
      <h1>Why a boundary check, and not another FDIR editor</h1>
      <p>Compressed build cycles mean autonomy, propulsion and payload software now land on buses that were designed by someone else. Each subsystem is tested in isolation. The line where the two sets of fault rules meet is reviewed on paper, late, by two teams holding different documents.</p>
    </section>

    <section class="prose" aria-labelledby="chain">
      <h2 id="chain">The inference, in four steps</h2>
      <ol>
        <li><strong>What happened.</strong> In the first week of November 2026 a spacecraft was lost after a bus fault-protection action removed its radio during commissioning, and a separate 3D-printing payload needed two months of ground work to survive its host bus.</li>
        <li><strong>What it implies.</strong> Startups are combining commercial buses, third-party subsystems and onboard autonomy on cycles of two to twelve months. The interface fault boundary between payload commands and bus FDIR rules is still tracked in spreadsheets and hand-coded conditionals.</li>
        <li><strong>Why it is existential.</strong> An unmapped FDIR state conflict in flight cannot be fixed with a hardware reset. It ends the mission, the milestone payments and the flight heritage at once.</li>
        <li><strong>What would disprove it.</strong> Telemetry showing that essentially all commissioning aborts are mechanical, with no software state transition involved, or evidence that every team already runs a formal cross-vendor reachability check before flight lock.</li>
      </ol>
    </section>

    <section class="prose" id="evidence" aria-labelledby="ev">
      <h2 id="ev">Evidence log</h2>
      <p>Dated public activity from October and November 2026, drawn from company releases, mission updates and trade press. These are the integrations that motivate the three reference tables; the tables themselves are illustrative and carry their own provenance line.</p>
      <div class="matrix-wrap">
        <table class="matrix">
          <caption>Integration activity, newest first.</caption>
          <thead><tr><th scope="col">programme</th><th scope="col">company</th><th scope="col">date</th><th scope="col">why it bears on the boundary</th><th scope="col">source</th></tr></thead>
          <tbody>
            ${evidenceRows
              .map(
                ([a, b, c, d, url]) =>
                  `<tr><td class="mono">${esc(a)}</td><td>${esc(b)}</td><td class="mono">${esc(c)}</td><td class="col-why">${esc(d)}</td><td><a href="${esc(url)}" rel="nofollow noopener">report</a></td></tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="note">Vendor names are used descriptively to identify public programmes. No affiliation or endorsement is implied, and no non-public information was used.</p>
    </section>

    <section class="prose" class="no-border" aria-labelledby="use">
      <h2 id="use">How the three templates map to that evidence</h2>
      <div class="cols cols--3">
        <div>
          <h3>Template A</h3>
          <p class="note">Bus FDIR against an onboard autonomy safety kernel during commissioning and shadow-mode handoff. The conflict class is a radio latch with no autonomous restore path.</p>
        </div>
        <div>
          <h3>Template B</h3>
          <p class="note">A high-voltage COTS battery protection event against a terminal-guidance flight controller. The conflict class is peak draw removing servo authority mid-intercept.</p>
        </div>
        <div>
          <h3>Template C</h3>
          <p class="note">A stage sequencer against a cryogenic valve controller across chilldown and plasma blackout. The conflict class is safing on a blackout with no telemetry to recover from it.</p>
        </div>
      </div>
      <p class="pad-top"><a href="/">Open the verifier</a> and read the traces on all three.</p>
    </section>
  </div>
</main>
`;

/* -------------------------------------------------------------- privacy -- */
const privacyBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <p class="eyebrow">Privacy</p>
      <h1>Nothing is collected, because nothing is sent</h1>
      <p>FaultGate is a static site. There is no backend, no account system, no analytics script, no cookie, no font loaded from a third party and no telemetry endpoint.</p>
    </section>
    <section class="prose">
      <h2>What happens to a table you load</h2>
      <p>The file is read with the browser File API and parsed in the page. It is not uploaded anywhere. Closing the tab discards it. Exporting a patch sheet builds the file locally and hands it to your own downloads directory.</p>
      <h2>What is stored on your device</h2>
      <ul>
        <li>Your theme choice, in <code>localStorage</code> under one key. Clearing site data removes it.</li>
        <li>Nothing else. The selected template is held in the page URL so a reload reproduces the view.</li>
      </ul>
      <h2>Hosting</h2>
      <p>The site is served as static files. Like any web server, the host may keep short-lived request logs containing IP address and user agent for operational and abuse purposes. FaultGate does not read or retain those logs.</p>
      <h2>Contact</h2>
      <p>Corrections and questions go to the project issue tracker: <a href="https://github.com/nakshjhaai-lgtm/Faultgate/issues">github.com/nakshjhaai-lgtm/Faultgate</a>.</p>
      <p class="note">Last updated 7 November 2026.</p>
    </section>
  </div>
</main>
`;

/* ----------------------------------------------------------------- 404 --- */
const notFoundBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <p class="eyebrow">404 · No such page</p>
      <h1>This state has no transition</h1>
      <p>The address you followed does not exist on this site. Nothing is broken on your side.</p>
      <div class="btn-row" class="pad-top">
        <a class="btn btn--primary" href="/">Open the verifier</a>
        <a class="btn btn--ghost" href="/docs.html">Table schema</a>
        <a class="btn btn--ghost" href="/how-it-works.html">How the check works</a>
      </div>
    </section>
    <section class="prose" class="no-border">
      <h2>Useful pages</h2>
      <ul>
        <li><a href="/">Boundary check</a>: run all three reference tables</li>
        <li><a href="/docs.html">Schema</a>: CSV and JSON formats with a worked example</li>
        <li><a href="/background.html">Background</a>: the failure evidence behind the tool</li>
      </ul>
    </section>
  </div>
</main>
`;

/* ---------------------------------------------------------------- write -- */
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(path.join(dist, 'templates'), { recursive: true });
await mkdir(path.join(dist, 'fonts'), { recursive: true });

const orgSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'FaultGate',
      applicationCategory: 'EngineeringApplication',
      operatingSystem: 'Any modern browser',
      url: `${SITE}/`,
      description: DESCRIPTION,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: [
        'Cross-subsystem FDIR reachability check',
        'Single, paired and triple fault injection',
        'Reproduction trace for every conflict',
        'ICD guard patch export as Markdown and CSV',
        'Runs entirely in the browser with no upload',
      ],
      author: { '@type': 'Person', name: AUTHOR },
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Does FaultGate upload my fault table?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. The table is parsed in the browser and never transmitted. There is no backend endpoint that accepts a table.',
          },
        },
        {
          '@type': 'Question',
          name: 'What file formats does it accept?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'A single CSV with meta, subsystem, state, transition, fault and rule records, or the equivalent JSON object. Both formats are documented on the schema page.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does a clear result mean the vehicle is safe to fly?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. A clear result means no interface rule fired for the transitions and faults entered in the table. It says nothing about behaviour that the table does not model.',
          },
        },
        {
          '@type': 'Question',
          name: 'How long does a check take?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'The three reference tables complete in well under a second in a current browser, including every single-fault and dual-fault combination.',
          },
        },
      ],
    },
  ],
};

const pages = [
  {
    file: 'index.html',
    slug: '/',
    title: TITLE,
    description: DESCRIPTION,
    body: indexBody,
    schema: orgSchema,
  },
  {
    file: 'how-it-works.html',
    slug: '/how-it-works.html',
    title: 'Method and limits · FaultGate',
    description:
      'How the FaultGate boundary check works: one state machine across two ICDs, held faults, breadth-first reachability, and the five ways a clear result can still mislead you.',
    body: howBody,
  },
  {
    file: 'docs.html',
    slug: '/docs.html',
    title: 'Fault table schema · FaultGate',
    description:
      'The FaultGate fault table format: meta, subsystem, state, transition, fault and rule records, the guard expression grammar, and a complete two-transition example in CSV and JSON.',
    body: docsBody,
  },
  {
    file: 'background.html',
    slug: '/background.html',
    title: 'Why cross-vendor FDIR boundaries fail · FaultGate',
    description:
      'Dated evidence from October and November 2026 on commissioning losses caused by cross-vendor fault-protection conflicts, the inference chain, and what would disprove it.',
    body: backgroundBody,
  },
  {
    file: 'privacy.html',
    slug: '/privacy.html',
    title: 'Privacy · FaultGate',
    description: 'FaultGate is a static site with no analytics and no backend. Tables are parsed in the browser and never uploaded.',
    body: privacyBody,
  },
  {
    file: '404.html',
    slug: '/404.html',
    title: 'Page not found · FaultGate',
    description: 'That address does not exist. Open the verifier, the schema reference or the method page instead.',
    body: notFoundBody,
  },
];

for (const p of pages) {
  await writeFile(path.join(dist, p.file), layout(p), 'utf8');
}

/* client bundle */
await build({
  entryPoints: [path.join(root, 'src/client.ts')],
  bundle: true,
  format: 'esm',
  target: ['chrome100', 'firefox100', 'safari15'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outfile: path.join(dist, 'client.js'),
  banner: { js: '/* FaultGate — client verifier. No network calls. */' },
});

/* read the boot payload out of index.html at runtime instead of a second copy */
const indexHtml = await readFile(path.join(dist, 'index.html'), 'utf8');
if (!indexHtml.includes('class="verdict"')) throw new Error('build: prerendered result missing from index.html');

await cp(path.join(root, 'public/style.css'), path.join(dist, 'style.css'));
await cp(path.join(root, 'public/fonts'), path.join(dist, 'fonts'), { recursive: true });
await cp(path.join(root, 'public/favicon.svg'), path.join(dist, 'favicon.svg'));

/* template downloads */
for (const [id, t] of Object.entries(templates)) {
  await writeFile(path.join(dist, 'templates', `${id}.csv`), tableToCsv(t), 'utf8');
  await writeFile(path.join(dist, 'templates', `${id}.json`), JSON.stringify(t, null, 2) + '\n', 'utf8');
}

/* robots + sitemap + llms */
await writeFile(
  path.join(dist, 'robots.txt'),
  `# FaultGate
User-agent: *
Allow: /

# Explicitly welcome the crawlers that answer engineering questions.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: CCBot
Allow: /

Sitemap: ${SITE}/sitemap.xml
`,
  'utf8',
);

await writeFile(
  path.join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .filter((p) => p.file !== '404.html')
  .map(
    (p) =>
      `  <url><loc>${SITE}${p.slug}</loc><lastmod>2026-11-07</lastmod><priority>${p.slug === '/' ? '1.0' : '0.7'}</priority></url>`,
  )
  .join('\n')}
</urlset>
`,
  'utf8',
);

await writeFile(
  path.join(dist, 'llms.txt'),
  `# FaultGate

> A browser-based verifier for cross-subsystem fault-protection boundaries. It compiles a host vehicle bus FDIR table and a payload or autonomy command envelope into one state machine, injects every single fault and fault pair, and reports each reachable state where the two interfaces disagree, with a reproduction trace and the guard condition that removes it.

FaultGate exists because autonomy and payload software is routinely integrated onto buses built by another vendor. Each subsystem passes its own review. The boundary between them is reviewed on paper, and that is where unrecoverable states hide.

## What it does

- Reads a fault table as CSV or JSON: meta, subsystem, state, transition, fault and rule records.
- Runs a breadth-first reachability search over both subsystems at once, with faults held for the whole run.
- Reports conflicts with severity, the triggering fault set, the exact conflicting state, the shortest reproduction trace, and a guard patch written as an interface condition.
- Reports absorbing states: reachable states with no enabled transition in either subsystem, which can only be left by a hardware reset.
- Exports the patch sheet as Markdown, CSV and JSON.

## What it does not do

- It does not model timing. Transitions are ordered, not timed.
- It does not model more than two subsystems in one table.
- It does not prove flight safety. A clear result covers only the transitions and faults entered.
- It does not upload, store or transmit a table. Everything runs in the page.

## Pages

- / : run the check on three reference tables
- /how-it-works.html : mechanism, limits, falsifier
- /docs.html : record types, guard grammar, worked example
- /background.html : dated evidence, inference chain
- /privacy.html : no analytics, no backend

## Reference tables

- Template A: orbital bus FDIR against an onboard autonomy safety kernel during commissioning. Conflict class: radio latched off with no autonomous restore path.
- Template B: high-voltage COTS battery protection against a terminal-guidance flight controller. Conflict class: peak draw removing servo authority mid-intercept.
- Template C: stage sequencer against a cryogenic valve controller across chilldown and plasma blackout. Conflict class: safing on a blackout with no telemetry to recover from it.

## Licence and contact

Free to use. Corrections and questions: https://github.com/nakshjhaai-lgtm/Faultgate/issues
`,
  'utf8',
);

/* security headers (Cloudflare Pages format) */
await writeFile(
  path.join(dist, '_headers'),
  `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; manifest-src 'self'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/client.js
  Cache-Control: public, max-age=31536000, immutable
  Content-Type: text/javascript; charset=utf-8

/style.css
  Cache-Control: public, max-age=604800

/templates/*
  Content-Type: text/csv; charset=utf-8
`,
  'utf8',
);

await writeFile(
  path.join(dist, '_redirects'),
  `# 404 is served by Cloudflare Pages automatically from /404.html.
/docs /docs.html 301
/method /how-it-works.html 301
`,
  'utf8',
);

/* manifest + icon */
await writeFile(
  path.join(dist, 'site.webmanifest'),
  JSON.stringify(
    {
      name: 'FaultGate',
      short_name: 'FaultGate',
      description: 'Cross-subsystem FDIR and command-boundary verifier.',
      start_url: '/',
      display: 'minimal-ui',
      background_color: '#ffffff',
      theme_color: '#0d5c63',
      icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

/* Open Graph image, rendered from the same tokens as the site */
const fontDir = path.join(root, 'node_modules/@fontsource');
const readFont = async (p) => readFile(path.join(root, p));
const archivo600 = await readFile(path.join(fontDir, 'archivo/files/archivo-latin-600-normal.woff'));
const archivo400 = await readFile(path.join(fontDir, 'archivo/files/archivo-latin-400-normal.woff'));
const mono400 = await readFile(path.join(fontDir, 'ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff'));

const ogMarkup = {
  type: 'div',
  props: {
    style: {
      // boxSizing is required: satori adds padding outside the declared size,
      // which pushed the footer row off the canvas entirely.
      boxSizing: 'border-box',
      width: '1200px',
      height: '630px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      background: '#ffffff',
      color: '#10161a',
      fontFamily: 'Archivo',
      padding: '56px 64px',
    },
    children: [
      {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'column' },
          children: [
            {
              type: 'div',
              props: {
                style: { display: 'flex', alignItems: 'center', gap: '10px' },
                children: [
                  {
                    type: 'svg',
                    props: {
                      width: 26,
                      height: 26,
                      viewBox: '0 0 22 22',
                      children: [
                        { type: 'rect', props: { x: 1, y: 1, width: 20, height: 20, rx: 2, fill: 'none', stroke: '#0d5c63', strokeWidth: 1.6 } },
                        { type: 'path', props: { d: 'M5 7h5v5H5z', fill: '#0d5c63' } },
                        { type: 'path', props: { d: 'M12 10h5M12 14h5M5 15h5', stroke: '#0d5c63', strokeWidth: 1.6, strokeLinecap: 'round' } },
                      ],
                    },
                  },
                  {
                    type: 'div',
                    props: { style: { fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em' }, children: 'FaultGate' },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  marginTop: '34px',
                  fontSize: 54,
                  lineHeight: 1.1,
                  letterSpacing: '-0.03em',
                  fontWeight: 600,
                  maxWidth: '960px',
                  display: 'flex',
                },
                children: 'Two ICDs, each correct. One vehicle that cannot recover.',
              },
            },
            {
              type: 'div',
              props: {
                style: { marginTop: '24px', fontSize: 24, color: '#5a6a73', lineHeight: 1.45, maxWidth: '930px', display: 'flex' },
                children:
                  'Injects every fault up to three at once across the bus FDIR table and the payload command envelope, then names the reachable states neither document covers.',
              },
            },
          ],
        },
      },
      {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            alignItems: 'center',
            borderTop: '1px solid #c9d2d7',
            paddingTop: '24px',
            fontFamily: 'Plex Mono',
            fontSize: 21,
            color: '#5a6a73',
          },
          children: [
            { type: 'div', props: { style: { color: '#8c1d18', marginRight: '26px' }, children: 'BLOCKED' } },
            { type: 'div', props: { style: { marginRight: '26px' }, children: '4 conflicts' } },
            { type: 'div', props: { style: { marginRight: '26px' }, children: '93 fault combinations' } },
            { type: 'div', props: { style: { color: '#10161a' }, children: 'faultgate.pages.dev' } },
          ],
        },
      },
    ],
  },
};

const svg = await satori(ogMarkup, {
  width: 1200,
  height: 630,
  fonts: [
    { name: 'Archivo', data: archivo600, weight: 600, style: 'normal' },
    { name: 'Archivo', data: archivo400, weight: 400, style: 'normal' },
    { name: 'Plex Mono', data: mono400, weight: 400, style: 'normal' },
  ],
});
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
await writeFile(path.join(dist, 'og.png'), png);

/* report */
const fileCount = (await import('node:fs')).readdirSync(dist, { recursive: true }).length;
console.log(`built ${fileCount} files into dist/`);
for (const [id, r] of [
  ['A', preRunA],
  ['B', preRunB],
  ['C', preRunC],
]) {
  console.log(
    `  template ${id}: ${r.findings.length} findings (${r.counts.critical}c/${r.counts.major}m/${r.counts.minor}n), ${r.combinations} combinations, ${r.worldsExplored} worlds, ${shared.formatDuration(r.durationMs)}`,
  );
}
