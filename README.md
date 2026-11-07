# FaultGate

A boundary verifier for cross-subsystem fault protection.

FaultGate reads a host vehicle bus FDIR table and a payload or autonomy command envelope as **one** state machine, injects every fault combination up to three at once, and names each reachable state where the two documents disagree. Every conflict comes with the shortest reproduction trace and an ICD guard patch written as an interface condition.

Live: **https://faultgate.pages.dev**

No install, no login, no upload. The table is parsed in the page with the File API and never leaves the browser.

## Why

Autonomy, propulsion and payload software now lands on buses built by another vendor, on cycles of two to twelve months. Each subsystem passes its own review. The FDIR boundary between them is reviewed on paper, late, by two teams holding different documents. When a fault crosses that boundary the two rule sets can enter a state neither document describes, and in flight there is no reset button.

FaultGate makes that boundary executable. See [background.html](https://faultgate.pages.dev/background.html) for the dated evidence log and the falsifier.

## What it does

- Compiles two subsystem FSMs plus cross-system guards into one transition system.
- Injects the nominal case, every single fault, every pair and every triple; a fault is held for the whole exploration, the way a real under-voltage trip persists.
- Explores breadth-first, so the trace printed for each finding is the shortest reproduction.
- Evaluates interface rules against whole-world guards, including `state(bus.X)` predicates that no per-document review can express.
- Reports absorbing states separately: reachable states with no enabled transition on either side.
- Exports the patch sheet as Markdown, CSV and JSON.

Three reference tables ship with it:

| id | subsystem pair | conflict class |
| --- | --- | --- |
| A | orbital bus FDIR + onboard autonomy safety kernel | radio latched off with no autonomous restore path |
| B | 470 V COTS battery BMS + terminal-guidance flight controller | peak draw removing servo authority mid-intercept |
| C | stage sequencer + cryogenic valve controller | safing during plasma blackout with no telemetry to recover |

## What it does not do

- It does not model timing. Transitions are ordered, not timed.
- It does not model more than two subsystems in one table.
- It does not prove flight safety. A clear result covers only the transitions and faults entered.

These limits are stated on the site as well, on [how-it-works.html#limits](https://faultgate.pages.dev/how-it-works.html#limits).

## Development

```bash
npm install
npm run build      # prerender dist/
npm run dev        # serve dist/ on :4173
npm test           # engine, CSV codec, exports
npm run check      # build self-audit: meta, headings, contrast tokens, CSP, dead links
```

A browser audit for contrast, hit targets, focus rings and the mobile menu needs a Chromium:

```bash
CHROME_PATH=/path/to/chrome node tools/audit-browser.mjs http://127.0.0.1:4173
```

`npm run verify` runs the whole chain.

### Layout

```
data/            the three reference fault tables (TypeScript)
src/engine.ts    guard evaluation, fault combination, reachability search
src/ingest.ts    CSV/JSON reader, guard expression parser, CSV writer
src/export.ts    Markdown, CSV and JSON patch sheets
src/render.ts    one renderer shared by the build and the client
src/client.ts    the interface: template picker, import, exports
tools/build.mjs  static build, prerender, OG image, headers, sitemap, llms.txt
tools/lint.mjs   build self-audit
tools/audit-browser.mjs  rendered-page audit
tests/           node:test suites
```

The build prerenders template A's full result into `index.html`, so the page is useful and readable before any script runs. `src/render.ts` is shared between the build and the client so the two cannot drift.

## Deploying

The output is static files. On Cloudflare Pages:

| setting | value |
| --- | --- |
| build command | `npm run build` |
| output directory | `dist` |
| node version | 20 or later |

`dist/_headers` carries the CSP, HSTS and permissions policy; `dist/_redirects` carries the two legacy paths. Nothing else is required: no functions, no bindings, no runtime.

Any other static host works. The only vendor-specific files are `_headers` and `_redirects`, both ignored elsewhere.

## Licence

MIT. See [LICENSE](LICENSE).
