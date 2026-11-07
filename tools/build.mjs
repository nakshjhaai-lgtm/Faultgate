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
 *  - robots.txt, sitemap.xml, llms.txt, _headers, _redirects, site.webmanifest,
 *    favicon.svg, og.png
 *
 * No framework, no runtime dependencies in the output. The only scripts are two
 * ES modules produced by esbuild.
 *
 * Pages are generated from the same section builders the client uses
 * (src/render.ts), so the prerendered result and the live one cannot drift.
 * Paths are relative so the bundle also opens correctly from the filesystem.
 */
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL as pathToFileUrl } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const SITE = 'https://faultgate.nakshjha-ai.workers.dev';
const TITLE = 'FaultGate, cross-subsystem FDIR and command-boundary verifier';
const DESCRIPTION =
  'Check a host bus fault-protection table against a payload command envelope. FaultGate names the states both ICDs allow and the vehicle still cannot leave.';
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
  ['index.html', 'Verifier'],
  ['how-it-works.html', 'Method'],
  ['docs.html', 'Schema'],
  ['background.html', 'Background'],
];

const brand = `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false"><rect x="1" y="1" width="20" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 7h5v5H5z" fill="currentColor"/><path d="M12 10h5M12 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 15h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

function layout({ file, slug, title, description, body, schema = null }) {
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}/${slug}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0d5c63">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FaultGate">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}/${slug}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="FaultGate: a cross-subsystem boundary check that returns blocked with three traceable conflicts.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/og.png">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="favicon.svg">
<link rel="manifest" href="site.webmanifest">
<link rel="preload" href="fonts/archivo-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/archivo-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="style.css">${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="shell site-head__inner">
    <a class="brand" href="index.html" aria-label="FaultGate home">${brand}<span translate="no">FaultGate</span></a>
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
          <li><a href="index.html">Boundary check</a></li>
          <li><a href="docs.html">Table schema</a></li>
          <li><a href="templates/A.csv">Template A (.csv)</a></li>
          <li><a href="templates/B.csv">Template B (.csv)</a></li>
          <li><a href="templates/C.csv">Template C (.csv)</a></li>
        </ul>
      </div>
      <div>
        <h2>Reading</h2>
        <ul>
          <li><a href="how-it-works.html">What the check proves</a></li>
          <li><a href="how-it-works.html#limits">Limits and falsifier</a></li>
          <li><a href="background.html">Why this exists</a></li>
          <li><a href="background.html#evidence">Evidence log</a></li>
        </ul>
      </div>
      <div>
        <h2>Contact</h2>
        <ul>
          <li><a href="https://github.com/nakshjhaai-lgtm/Faultgate/issues">Open an issue</a></li>
          <li><a href="llms.txt">llms.txt</a></li>
          <li><a href="privacy.html">Privacy</a></li>
        </ul>
      </div>
    </div>
    <div class="site-foot__base">
      <span>&copy; ${YEAR} ${AUTHOR}</span>
      <span>No analytics, no cookies, no accounts</span>
      <span>rev ${pkg.version} &middot; 7 Nov ${YEAR}</span>
    </div>
  </div>
</footer>
<button class="to-top" id="to-top" type="button" aria-label="Back to top">
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 10V2M2.5 5.5L6 2l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  Top
</button>
<script type="module" src="client.js"></script>
<script type="module" src="ui.js"></script>
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
      <span class="tpl__counts">${t.subsystems.reduce((n, s) => n + s.states.length, 0)} states &middot; ${t.subsystems.reduce((n, s) => n + s.transitions.length, 0)} transitions &middot; ${t.faults.length} faults &middot; ${t.boundary.length} rules</span>
    </button>`,
  )
  .join('');

const preRunA = runCheck(templateA, { maxFaultDepth: 3 });
const preRunB = runCheck(templateB, { maxFaultDepth: 3 });
const preRunC = runCheck(templateC, { maxFaultDepth: 3 });

// The hero specimen: rule BG-01 from template A, fault F1, laid out the way the
// verifier prints it. States, flags, transitions and the guard patch are the
// table's own strings; the two labels are shortened for the narrow column.
const specimen = `<aside class="specimen" aria-label="Sample finding from template A">
        <div class="specimen__bar"><b>Template A</b><span>fault F1</span><span class="spacer"></span><span>2 transitions</span></div>
        <div class="specimen__body">
          <div class="specimen__title">
            <h2>Radio latched off with no autonomous restore path</h2>
            <span class="sev" data-sev="critical">critical</span>
          </div>
          <div class="specimen__pair">
            <div><span class="k">Host bus FDIR</span><span class="mono">RADIO_OFF</span><span>radio transceiver off</span></div>
            <div><span class="k">Autonomy kernel</span><span class="mono">KERNEL_IDLE</span><span>kernel idle</span></div>
            <div><span class="k">Asserted flags</span><span class="mono">bus.uv_trip</span></div>
          </div>
          <ol class="specimen__trace">
            <li>bus COMMISSIONING &rarr; RADIO_ON &middot; commissioning window opens the transceiver</li>
            <li>bus RADIO_ON &rarr; RADIO_OFF &middot; under-voltage trip removes non-essential load</li>
          </ol>
          <p class="specimen__note">Both steps are legal in the bus table. The conflict is the pair: the kernel needs the radio to keep commanding, and nothing in either document forbids both events.</p>
        </div>
      </aside>`;

const indexBody = `
<main id="main">
  <div class="shell">
    <section class="hero hero--split">
      <div>
        <h1>Two ICDs, each correct. One vehicle that cannot recover.</h1>
        <p>FaultGate compiles the host bus fault-protection table and the payload command envelope into one state machine, injects every fault combination up to three at once, and names each reachable state where the two documents disagree. The table never leaves this tab.</p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="#check">Run the check</a>
          <a class="btn btn--ghost" href="how-it-works.html">What the check proves</a>
        </div>
        <p class="hero__aside">The three reference tables are illustrative programmes. Each one carries its provenance line.</p>
      </div>

      <!-- Specimen: template A, fault F1, exactly as the verifier prints it. -->
      ${specimen}
    </section>

    <section class="steps" aria-labelledby="steps-title">
      <h2 id="steps-title">How a check runs</h2>
      <ol>
        <li><span><strong>Pick a table</strong>One of the three reference tables below, or your own bus and payload CSV.</span></li>
        <li><span><strong>Run it</strong>Every single fault, every pair and every triple is injected, then both state spaces are explored together.</span></li>
        <li><span><strong>Take the patch</strong>Each conflict arrives with its trace and the interface condition that removes it, as Markdown or CSV.</span></li>
      </ol>
    </section>

    <section id="check" aria-labelledby="pick-title" class="stack">
      <h2 id="pick-title" class="sr">Choose a fault table</h2>
      <div class="picker" id="picker">${templateCards}</div>
      <div id="chosen" aria-live="polite"></div>

      <div class="drop" id="drop">
        <p><strong>Drop a fault table here</strong>, or choose a file. CSV or JSON, one record per row, 2&nbsp;MB.</p>
        <div class="drop__row">
          <button type="button" class="btn btn--ghost" id="browse">Choose file</button>
          <button type="button" class="btn btn--ghost" id="download-sample">Download this template as CSV</button>
          <input type="file" id="file" accept=".csv,.json,text/csv,application/json" class="sr" tabindex="-1" aria-label="Fault table file">
        </div>
        <p class="note">The file is read by the browser and never uploaded. Columns and the guard grammar are on the <a href="docs.html">schema page</a>.</p>
      </div>

      <div id="error" class="hide" aria-live="assertive"></div>

      <div class="btn-row pad-top">
        <button type="button" class="btn btn--primary" id="run">
          <span class="spin" aria-hidden="true"></span>
          <span class="btn__label">Run boundary check</span>
        </button>
        <span class="note">Runs locally. Shortcut: <kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>Enter</kbd></span>
      </div>
    </section>

<section id="result" class="prose no-border prose--result" aria-live="polite">
${shared.renderResult(templateA, preRunA)}
</section>

    <section class="prose no-border" aria-labelledby="faq-title">
      <h2 id="faq-title">Questions the tool gets asked</h2>
      <dl class="faq">
        <div><dt>Does FaultGate upload my fault table?</dt><dd>No. The browser reads the file and the page parses it. There is no endpoint that accepts a table, and closing the tab discards it.</dd></div>
        <div><dt>Which file formats does it take?</dt><dd>One CSV, or the equivalent JSON object. The record types, the guard grammar and a worked example are on the schema page.</dd></div>
        <div><dt>Does a clear result mean the vehicle is safe to fly?</dt><dd>No. It means no interface rule fired for the transitions and faults you entered. Sign-off stays with the systems engineer who owns the interface.</dd></div>
        <div><dt>How long does a check take?</dt><dd>The three reference tables finish in well under a second in a current browser, including every single-fault and pair combination.</dd></div>
        <div><dt>Does it need an install, an account or a connection?</dt><dd>No install and no account. The page is static files; once it has loaded, the check runs in the tab.</dd></div>
      </dl>
    </section>
  </div>
</main>
`;

/* --------------------------------------------------------- how it works -- */
const howBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <h1>What the check actually proves</h1>
      <p>A verifier is worth keeping only if it says what it cannot see. FaultGate answers one question: given these two tables and this fault set, is any cross-subsystem state reachable in which an interface rule breaks? The mechanism is below, and the places it fails come at the end.</p>
    </section>

    <section class="prose" aria-labelledby="mech">
      <h2 id="mech">Mechanism</h2>

      <h3>One state machine, not two</h3>
      <p>The bus FDIR table and the payload command envelope compile into a single transition system. Each transition is guarded by the other subsystem&rsquo;s state, which is where interface requirements live and where a review of either ICD on its own cannot look.</p>

      <h3>Faults stay asserted for the whole run</h3>
      <p>Under-voltage present, watchdog expired, uplink unavailable: every fault holds its flag from the first transition to the last. Single faults and pairs run as separate sweeps, so a conflict that needs two failures at once reports both of them by name.</p>

      <h3>A rule only counts if it is reachable</h3>
      <p>The search walks breadth-first from the commissioning seed state. A rule becomes a finding when some ordered sequence of legal transitions reaches it. A rule that reads alarming but cannot be reached is reported as clean, and the sheet says so.</p>

      <h3>The trace is the shortest one</h3>
      <p>Breadth-first order makes the printed trace the shortest reproduction of the conflict. Anyone can replay it by hand against the ICDs, which is what makes the finding arguable in a review rather than something to take on trust.</p>

      <h3>States you cannot leave</h3>
      <p>A reachable state with no enabled transition in either subsystem can only be exited by a hardware reset. On a spacecraft that reset does not exist, so these are listed separately from rule violations.</p>
    </section>

    <section class="prose" id="limits" aria-labelledby="limits-t">
      <h2 id="limits-t">Limits, stated plainly</h2>
      <p>These are the ways a clear result can mislead you. They are on this page instead of in a footnote, because a verifier that hides its blind spots is worse than no verifier.</p>

      <h3>The model ends where your table ends</h3>
      <p>The result is only as complete as the transitions and faults you entered. Interlocks built in analogue circuitry, in an FPGA bitstream, or in a firmware path that is missing from the table sit outside the model and will not be reported.</p>

      <h3>Faults stay on</h3>
      <p>A fault persists for the whole run. A transient shorter than a control period is not modelled, and it can hide a conflict that only appears on a rising edge.</p>

      <h3>Two subsystems only</h3>
      <p>The schema models one bus and one controller. A three-way conflict between bus, payload and ground segment has to be reduced to two before it can be entered.</p>

      <h3>No timing</h3>
      <p>Transitions are ordered, not timed. A conflict that needs two events inside 10&nbsp;ms is reported whenever the order is possible, even where the real margin is comfortable.</p>

      <h3>A clear result is not flight clearance</h3>
      <p>It means no rule fired for this table. Sign-off stays with the systems engineer who owns the interface, which is why every export carries the table revision, the fault set and the trace.</p>
    </section>

    <section class="prose" aria-labelledby="fals">
      <h2 id="fals">What would show this tool is unnecessary</h2>
      <p>The premise is that cross-vendor FDIR boundary conflicts are a live failure mode and not a theoretical one. Two observations would falsify it: flight telemetry showing that nearly all commissioning aborts trace to mechanical or structural failure with no software state transition involved, or evidence that teams already run a formal cross-vendor reachability check before flight lock.</p>
      <p>If the second becomes true, FaultGate should be retired. If the first holds for your programme, the fault table on your desk should be about structures.</p>
    </section>

    <section class="prose no-border" aria-labelledby="time">
      <h2 id="time">On the time claim</h2>
      <p>A boundary audit by hand means reading two ICDs side by side, listing every pair of states that can coexist, and checking each pair against the interface requirements. At the size of the templates here that is about a working day, and it is the first task cut when a launch date moves.</p>
      <p>The enumeration is the slow part, and it is the part a machine does. On the three reference tables FaultGate evaluates 93, 26 and 26 fault combinations in under a second. What it produces gets reviewed instead of drafted. That gives the working figure of 30 minutes to review an exported patch sheet against an 8-hour manual pass, or 7.5 hours saved per integration review.</p>
      <p>Treat it as an estimate for this class of table, not a measurement of your programme. It assumes the tables you feed in are maintained, and that review only has to confirm findings the tool has already located and traced. If the tables are not maintained, fix that first.</p>
      <p class="pad-top">The reference tables take under a second to run. <a href="index.html">Read the traces</a> before you trust the summary.</p>
    </section>
  </div>
</main>
`;

/* ------------------------------------------------------------- docs ----- */
const docsBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <h1>The table schema</h1>
      <p>One CSV or one JSON object holds the whole model: metadata, both subsystems, their states, the transitions between them, the faults to inject, and the boundary rules to test. <a href="templates/A.csv">Template A</a> is the worked example throughout this page.</p>
    </section>

    <section class="prose" aria-labelledby="records">
      <h2 id="records">Records</h2>
      <p>CSV is a flat file of typed rows. The <span class="mono">record</span> column decides how a row is read; unused columns stay empty.</p>
      <dl class="deflist pad-top-sm">
        <div><dt>meta</dt><dd>Table name in <span class="mono">label</span>, revision in <span class="mono">ref</span>, the summary in <span class="mono">guard_patch</span>, provenance in <span class="mono">match</span>.</dd></div>
        <div><dt>subsystem</dt><dd>One row per subsystem. <span class="mono">subsystem</span> is the id, <span class="mono">vendor</span> the name shown in reports, <span class="mono">role</span> is <span class="mono">bus</span>, <span class="mono">payload</span> or <span class="mono">controller</span>, and <span class="mono">initial</span> is the seed state.</dd></div>
        <div><dt>state</dt><dd><span class="mono">subsystem</span> and <span class="mono">state</span> are required, <span class="mono">label</span> is human text. <span class="mono">effects</span> takes <span class="mono">terminal</span> or <span class="mono">safe</span> as a hint about the state.</dd></div>
        <div><dt>transition</dt><dd>Needs <span class="mono">subsystem</span>, <span class="mono">from_state</span> and <span class="mono">to_state</span>. <span class="mono">guard</span> defaults to <span class="mono">always()</span>, <span class="mono">effects</span> lists flag changes, <span class="mono">ref</span> is the ICD clause this transition comes from.</dd></div>
        <div><dt>fault</dt><dd><span class="mono">id</span> and <span class="mono">label</span>, then <span class="mono">asserts</span> and <span class="mono">clears</span> as comma-separated flags. A fault is held for the whole run.</dd></div>
        <div><dt>rule</dt><dd>A boundary condition to test: <span class="mono">id</span>, <span class="mono">label</span>, <span class="mono">severity</span> of <span class="mono">critical</span>, <span class="mono">major</span> or <span class="mono">minor</span>, the <span class="mono">match</span> guard, and the <span class="mono">guard_patch</span> text you want exported with it.</dd></div>
      </dl>
    </section>

    <section class="prose" aria-labelledby="grammar">
      <h2 id="grammar">Guard grammar</h2>
      <p>Guards are a small boolean language. Parsing is case-insensitive for the operators, and parentheses group.</p>
      <div class="matrix-wrap pad-top-sm">
        <table class="matrix">
          <thead><tr><th scope="col">form</th><th scope="col">reads as</th></tr></thead>
          <tbody>
            <tr><td class="mono">always()</td><td>No condition. The transition is always enabled.</td></tr>
            <tr><td class="mono">flag(bus.uv_trip)</td><td>The flag is set.</td></tr>
            <tr><td class="mono">state(bus.SAFE_MODE)</td><td>That subsystem is in that state.</td></tr>
            <tr><td class="mono">NOT flag(watchdog.enabled)</td><td>The flag is clear.</td></tr>
            <tr><td class="mono">flag(a) AND flag(b)</td><td>Both hold. <span class="mono">OR</span> needs either.</td></tr>
            <tr><td class="mono">state(x) AND NOT flag(y)</td><td>Mixed conditions, nested with parentheses where needed.</td></tr>
          </tbody>
        </table>
      </div>
      <p class="pad-top-sm">A bare identifier such as <span class="mono">bus.uv_trip</span> is read as <span class="mono">flag(bus.uv_trip)</span>. Effects are separate from guards: they are a comma-separated list where <span class="mono nowrap">+radio.enabled</span> sets a flag and <span class="mono nowrap">-radio.enabled</span> clears it.</p>
    </section>

    <section class="prose" aria-labelledby="example">
      <h2 id="example">Two records, worked through</h2>
      <p>A transition and the rule that catches it, both taken from template&nbsp;A:</p>
      <div class="matrix-wrap pad-top-sm">
        <table class="matrix">
          <thead><tr><th scope="col">record</th><th scope="col">subsystem</th><th scope="col">from_state</th><th scope="col">to_state</th><th scope="col">guard</th><th scope="col">effects</th><th scope="col">ref</th></tr></thead>
          <tbody>
            <tr><td class="mono">transition</td><td class="mono">bus</td><td class="mono">RADIO_ON</td><td class="mono">RADIO_OFF</td><td class="mono">flag(bus.uv_trip)</td><td class="mono">-radio.enabled</td><td class="mono">BUS-FDIR-14</td></tr>
          </tbody>
        </table>
      </div>
      <p class="pad-top-sm">With fault F1 held, that transition is legal, so <span class="mono">bus.RADIO_OFF</span> is reachable. The rule below then fires there, because the watchdog is not enabled and no uplink exists:</p>
      <div class="matrix-wrap pad-top-sm">
        <table class="matrix">
          <thead><tr><th scope="col">record</th><th scope="col">id</th><th scope="col">severity</th><th scope="col">match</th></tr></thead>
          <tbody>
            <tr><td class="mono">rule</td><td class="mono">BG-01</td><td>critical</td><td class="mono">state(bus.RADIO_OFF) AND NOT flag(watchdog.enabled) AND NOT flag(ground.uplink)</td></tr>
          </tbody>
        </table>
      </div>
      <p class="pad-top-sm">The exported sheet pairs that rule with its <span class="mono">guard_patch</span>: the interface condition to add, the trace that reaches the state, and the reference numbers from both ICDs.</p>
    </section>

    <section class="prose no-border" aria-labelledby="json">
      <h2 id="json">JSON form</h2>
      <p>A JSON table is one object: four strings, three arrays. It carries the same model as the CSV, and the importer names the field that failed rather than rejecting the whole file without explanation.</p>
      <div class="matrix-wrap pad-top-sm">
        <table class="matrix">
          <thead><tr><th scope="col">key</th><th scope="col">holds</th></tr></thead>
          <tbody>
            <tr><td class="mono">name, summary, provenance, revision</td><td>Strings. They head the report and the ICD export.</td></tr>
            <tr><td class="mono">subsystems[]</td><td><span class="mono">id</span>, <span class="mono">role</span> (<span class="mono">bus</span>, <span class="mono">payload</span> or <span class="mono">controller</span>), <span class="mono">vendor</span>, <span class="mono">initial</span>, then <span class="mono">states[]</span> and <span class="mono">transitions[]</span>.</td></tr>
            <tr><td class="mono">states[]</td><td><span class="mono">id</span>, <span class="mono">label</span>, and two optional booleans, <span class="mono">terminalHint</span> and <span class="mono">safe</span>.</td></tr>
            <tr><td class="mono">transitions[]</td><td><span class="mono">from</span>, <span class="mono">to</span>, <span class="mono">label</span>, <span class="mono">guard</span>, and <span class="mono">effects[]</span>. The effects array is required even when the transition changes no flag.</td></tr>
            <tr><td class="mono">faults[]</td><td><span class="mono">id</span>, <span class="mono">label</span>, <span class="mono">asserts[]</span>, <span class="mono">clears[]</span>, optional <span class="mono">ref</span>. An empty array runs the nominal case.</td></tr>
            <tr><td class="mono">boundary[]</td><td><span class="mono">id</span>, <span class="mono">label</span>, <span class="mono">severity</span>, <span class="mono">match</span>, <span class="mono">guardPatch</span>, optional <span class="mono">ref</span>. A table with no rule records still imports. The page then says plainly that nothing was tested, because every rule a table does not contain passes.</td></tr>
          </tbody>
        </table>
      </div>
      <p class="pad-top-sm">Guards are objects here, not the strings the CSV column holds. Where the CSV reads <span class="mono">flag(bus.uv_trip) AND NOT state(payload.SAFE)</span>, the JSON is <span class="mono">{"and":[{"flag":"bus.uv_trip"},{"not":{"state":"payload.SAFE"}}]}</span>. The forms:</p>
      <div class="matrix-wrap pad-top-sm">
        <table class="matrix">
          <thead><tr><th scope="col">CSV</th><th scope="col">JSON</th></tr></thead>
          <tbody>
            <tr><td class="mono">always()</td><td class="mono">{"always":true}</td></tr>
            <tr><td class="mono">flag(bus.uv_trip)</td><td class="mono">{"flag":"bus.uv_trip"}</td></tr>
            <tr><td class="mono">NOT flag(watchdog.expired)</td><td class="mono">{"flag":"watchdog.expired","when":"clear"}</td></tr>
            <tr><td class="mono">state(payload.SAFE)</td><td class="mono">{"state":"payload.SAFE"}</td></tr>
            <tr><td class="mono">flag(a) OR flag(b)</td><td class="mono">{"or":[{"flag":"a"},{"flag":"b"}]}</td></tr>
            <tr><td class="mono">NOT flag(x)</td><td class="mono">{"not":{"flag":"x"}}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="pad-top-sm">Two more keys sit outside the model. <span class="mono">effects</span> entries are <span class="mono">{"kind":"set","flag":"radio.enabled"}</span> or <span class="mono">{"kind":"clear","flag":"radio.enabled"}</span>, the equivalents of <span class="mono nowrap">+radio.enabled</span> and <span class="mono nowrap">-radio.enabled</span>. Transitions, faults and rules also accept a <span class="mono">ref</span> string naming the ICD clause they came from, and that string travels into the exports.</p>
      <p class="pad-top">To keep the CSV route open, the verifier exports the sheet as Markdown, CSV and JSON from the result block. The CSV is the one to edit in a spreadsheet; drop it back on the <a href="index.html#check">verifier</a> when you are done.</p>
    </section>
  </div>
</main>
`;

/* --------------------------------------------------------- background --- */
const backgroundBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <h1>Where boundary faults come from</h1>
      <p>Compressed build cycles mean autonomy, propulsion and payload software now land on buses that were designed by someone else. Each subsystem is tested in isolation. The line where the two sets of fault rules meet is reviewed on paper, late, by two teams holding different documents.</p>
    </section>

    <section class="prose" aria-labelledby="chain">
      <h2 id="chain">The argument</h2>
      <p>In the first week of November 2026 a spacecraft was lost after a bus fault-protection action removed its radio during commissioning. A separate 3D-printing payload needed two months of ground work before it could survive its host bus.</p>
      <p>Both events sit at the same seam. Startups are combining commercial buses, third-party subsystems and onboard autonomy on cycles of two to twelve months, while the fault boundary between payload commands and bus FDIR rules is still tracked in spreadsheets and hand-coded conditionals.</p>
      <p>In flight there is no repair. An unmapped FDIR state conflict cannot be cleared with a hardware reset, so one reachable pair of states ends the mission, the milestone payments and the flight heritage together.</p>
      <p>The argument fails if telemetry shows that essentially all commissioning aborts are mechanical, with no software state transition involved, or if every team already runs a formal cross-vendor reachability check before flight lock.</p>
    </section>

    <section class="prose" id="evidence" aria-labelledby="ev">
      <h2 id="ev">Evidence log</h2>
      <p>Dated public activity from October and November 2026, drawn from company releases, mission updates and trade press. These are the integrations that motivate the three reference tables; the tables themselves are illustrative and carry their own provenance line.</p>
      <div class="matrix-wrap">
        <table class="matrix">
          <caption>Integration activity, newest first.</caption>
          <thead><tr><th scope="col">programme</th><th scope="col">company</th><th scope="col">date</th><th scope="col">why it bears on the boundary</th><th scope="col">source</th></tr></thead>
          <tbody>
            <tr><td class="mono">Otter 24C</td><td>Starfish Space</td><td class="mono nowrap">2026-11-04</td><td class="col-why">Contact lost on the NASA SSPICY inspection mission after a third-party bus fault-protection action removed the radio during commissioning.</td><td><a href="https://payloadspace.com/starfish-loses-contact-with-otter-cutting-sspicy-short/" rel="nofollow noopener">report</a></td></tr><tr><td class="mono">Replicator 2</td><td>Orbital Matter / EnduroSat</td><td class="mono nowrap">2026-11-04</td><td class="col-why">First orbital print attempt failed on a third-party bus; two months of ground testing and a firmware patch were needed before a 32.5 cm boom printed in vacuum.</td><td><a href="https://payloadspace.com/orbital-matter-endurosat-announce-an-in-space-manufacturing-mission-in-2028/" rel="nofollow noopener">report</a></td></tr><tr><td class="mono">Astraeus</td><td>Orbital Operations</td><td class="mono nowrap">2026-10-23</td><td class="col-why">Up-to-$35M DoD prototype award for a cryogenic spacecraft, where thermal-management fault rules must not conflict with burn preparation.</td><td><a href="https://payloadspace.com/exclusive-dod-taps-orbital-operations-for-cryogenic-spacecraft-demo/" rel="nofollow noopener">report</a></td></tr><tr><td class="mono">Big Iron</td><td>Cowboy Space</td><td class="mono nowrap">2026-10-26</td><td class="col-why">An 86-metre rocket whose upper stage stays in orbit as a GPU data centre, sharing radiator and coolant plumbing with ascent fault rules.</td><td><a href="https://payloadspace.com/cowboy-space-reveals-big-iron-data-center-rocket/" rel="nofollow noopener">report</a></td></tr><tr><td class="mono">Starburst-1</td><td>Portal Space Systems</td><td class="mono nowrap">2026-10-23</td><td class="col-why">Orbital checkout complete on a bus designed to fly multi-vendor third-party payloads, then activate ammonia propulsion.</td><td><a href="https://payloadspace.com/portal-space-systems-completes-starburst-1-checkout/" rel="nofollow noopener">report</a></td></tr><tr><td class="mono">Orca OS</td><td>Orca Aerospace / Orbital</td><td class="mono nowrap">2026-11-05</td><td class="col-why">Up-to-$20M deal to layer an onboard AI planner, command translator and deterministic safety kernel onto a third-party bus.</td><td><a href="https://payloadspace.com/exclusive-orbital-taps-orca-aerospace-for-onboard-autonomy-software/" rel="nofollow noopener">report</a></td></tr>
          </tbody>
        </table>
      </div>
      <p class="note">Vendor names are used descriptively to identify public programmes. No affiliation or endorsement is implied, and no non-public information was used.</p>
    </section>

    <section class="prose no-border" aria-labelledby="use">
      <h2 id="use">How the three templates map to that evidence</h2>
      <div class="cols cols--3 pad-top-sm">
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
      <p class="pad-top">All three are in the verifier. <a href="index.html">Run one</a> and read the traces.</p>
    </section>
  </div>
</main>
`;

/* -------------------------------------------------------------- privacy -- */
const privacyBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <h1>Nothing is collected, because nothing is sent</h1>
      <p>FaultGate is a static site. No backend, no accounts, no analytics script, no cookie, no third-party font, no telemetry endpoint.</p>
    </section>

    <section class="prose">
      <h2>What happens to a table you load</h2>
      <p>The browser reads the file and the page parses it. Nothing is uploaded anywhere, and closing the tab discards it. An export is built locally and handed to your own downloads directory.</p>

      <h2>What is stored on your device</h2>
      <p>Your theme choice, in <span class="mono">localStorage</span>, under one key. Clearing site data removes it. The selected template is held in the page URL so a reload reproduces the view.</p>

      <h2>Hosting</h2>
      <p>The site is served as static files. Like any web server, the host may keep short-lived request logs containing IP address and user agent for operation and abuse handling. FaultGate does not read or retain them.</p>

      <h2>Contact</h2>
      <p>Corrections and questions go to the issue tracker: <a href="https://github.com/nakshjhaai-lgtm/Faultgate/issues">github.com/nakshjhaai-lgtm/Faultgate</a>.</p>
      <p class="note pad-top-sm">Last updated 7 November 2026.</p>
    </section>
  </div>
</main>
`;

/* ----------------------------------------------------------------- 404 --- */
const notFoundBody = `
<main id="main">
  <div class="shell">
    <section class="hero">
      <h1>That page is not here</h1>
      <p>The address you followed does not exist on this site. Nothing was lost: the verifier keeps no state outside your browser.</p>
      <div class="hero__actions">
        <a class="btn btn--primary" href="index.html">Run the check</a>
        <a class="btn btn--ghost" href="how-it-works.html">What the check proves</a>
      </div>
    </section>

    <section class="prose no-border">
      <h2>Where things are</h2>
      <dl class="deflist">
        <div><dt><a href="index.html">Verifier</a></dt><dd>The boundary check, on three reference tables or your own CSV.</dd></div>
        <div><dt><a href="how-it-works.html">Method</a></dt><dd>What the search does, what it cannot see, and what would falsify it.</dd></div>
        <div><dt><a href="docs.html">Schema</a></dt><dd>Record types, the guard grammar, and a worked two-record example.</dd></div>
        <div><dt><a href="background.html">Background</a></dt><dd>The dated integration activity this was built against.</dd></div>
        <div><dt><a href="privacy.html">Privacy</a></dt><dd>No upload, no analytics, no accounts.</dd></div>
      </dl>
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
            text: 'No. The browser reads the file and the page parses it. There is no endpoint that accepts a table, and closing the tab discards it.',
          },
        },
        {
          '@type': 'Question',
          name: 'Which file formats does it take?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'One CSV, or the equivalent JSON object. The record types, the guard grammar and a worked example are on the schema page.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does a clear result mean the vehicle is safe to fly?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. It means no interface rule fired for the transitions and faults you entered. Sign-off stays with the systems engineer who owns the interface.',
          },
        },
        {
          '@type': 'Question',
          name: 'How long does a check take?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'The three reference tables finish in well under a second in a current browser, including every single-fault and pair combination.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does it need an install, an account or a connection?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No install and no account. The page is static files; once it has loaded, the check runs in the tab.',
          },
        },
      ],
    },
  ],
};

const pages = [
  {
    file: 'index.html',
    slug: '',
    title: TITLE,
    description: DESCRIPTION,
    body: indexBody,
    schema: orgSchema,
  },
  {
    file: 'how-it-works.html',
    slug: 'how-it-works.html',
    title: 'Method and limits, FaultGate',
    description:
      'What the FaultGate check proves, what it cannot see, and the observations that would make it unnecessary.',
    body: howBody,
  },
  {
    file: 'docs.html',
    slug: 'docs.html',
    title: 'Table schema, FaultGate',
    description:
      'Record types, the guard grammar and a worked example for FaultGate fault tables, as CSV or JSON.',
    body: docsBody,
  },
  {
    file: 'background.html',
    slug: 'background.html',
    title: 'Why cross-vendor FDIR boundaries fail, FaultGate',
    description:
      'The dated public integration activity behind FaultGate, and why cross-vendor FDIR boundaries are where unrecoverable states hide.',
    body: backgroundBody,
  },
  {
    file: 'privacy.html',
    slug: 'privacy.html',
    title: 'Privacy, FaultGate',
    description: 'FaultGate runs entirely in the browser: no upload, no analytics, no cookies, no accounts.',
    body: privacyBody,
  },
  {
    file: '404.html',
    slug: '404.html',
    title: 'Page not found, FaultGate',
    description: 'That page does not exist. The verifier, the method, the schema and the background are one link away.',
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

/* interface behaviours: back to top, stale-result and no-rule notes */
await cp(path.join(root, 'public/ui.js'), path.join(dist, 'ui.js'));

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

/* security headers: one file, read by the worker deployment */
await writeFile(
  path.join(dist, '_headers'),
  `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; manifest-src 'self'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/client.js
  Cache-Control: public, max-age=31536000, immutable

/style.css
  Cache-Control: public, max-age=604800
`,
  'utf8',
);

await writeFile(
  path.join(dist, '_redirects'),
  `# The site is served from the domain root, so legacy paths only.
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

/* Open Graph image: the 1200x630 share card that ships with the bundle. */
await cp(path.join(root, 'public/og.png'), path.join(dist, 'og.png'));

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
