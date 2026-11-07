import type { CheckResult, FaultTable, Finding, Guard } from './types';
import { formatDuration, sortFindings } from './export';

/**
 * HTML rendering for check results.
 *
 * One renderer serves two callers: the build prerenders template A's result
 * into index.html so the page is useful before any script runs (and readable by
 * crawlers), and the client re-renders on demand. Keeping a single source means
 * the prerendered and live versions cannot drift.
 */

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function guardText(g: Guard): string {
  if ('always' in g) return 'always';
  if ('flag' in g) return g.flag;
  if ('state' in g) return g.state;
  if ('not' in g) return `NOT ${guardText(g.not)}`;
  if ('and' in g) return g.and.map(guardText).join(' AND ');
  if ('or' in g) return g.or.map(guardText).join(' OR ');
  return '?';
}

const stateLabel = (t: FaultTable, subId: string, stateId: string) =>
  t.subsystems.find((s) => s.id === subId)?.states.find((x) => x.id === stateId)?.label ?? stateId;

function findingCard(t: FaultTable, f: Finding, i: number): string {
  const faultText = f.faults.length ? f.faults.join(' + ') : 'no injected fault';
  const faultNames = f.faults
    .map((id) => {
      const fault = t.faults.find((x) => x.id === id);
      return fault ? fault.label : id;
    })
    .join('; ');

  const worlds = t.subsystems
    .map(
      (s) =>
        `<li><b>${esc(s.vendor)}</b> · <span class="mono">${esc(f.world.states[s.id] ?? '')}</span> ${esc(
          stateLabel(t, s.id, f.world.states[s.id] ?? ''),
        )}</li>`,
    )
    .join('');

  const trace =
    f.trace.length === 0
      ? `<li><span class="n">·</span><span>The seed state already violates this rule: a static conflict between the two documents, not a fault sequence.</span></li>`
      : f.trace
          .map((s, n) => {
            const eff = s.effects.length
              ? ` <span class="eff">${esc(s.effects.map((e) => `${e.kind === 'set' ? '+' : '−'}${e.flag}`).join(' '))}</span>`
              : '';
            return `<li><span class="n">${n + 1}</span><span><b>${esc(s.subsystem)}</b> ${esc(s.from)} → ${esc(
              s.to,
            )} · ${esc(s.label)}${eff}</span></li>`;
          })
          .join('');

  return `<article class="finding" data-sev="${f.severity}" aria-labelledby="f-${i}-title">
  <div class="finding__head">
    <span class="finding__id">${esc(f.ruleId)}</span>
    <h3 class="finding__title" id="f-${i}-title">${esc(f.ruleLabel)}</h3>
    <span class="sev" data-sev="${f.severity}">${f.severity}</span>
  </div>
  <div class="finding__body">
    <div class="finding__grid">
      <div class="fieldset">
        <h4>Triggering fault set</h4>
        <p class="mono ink">${esc(faultText)}</p>
        ${faultNames ? `<p class="note">${esc(faultNames)}</p>` : '<p class="note">The seeded state violates this rule with no fault injected.</p>'}
      </div>
      <div class="fieldset">
        <h4>Conflicting world</h4>
        <ul class="plain">${worlds}</ul>
        <p class="note">asserted flags: <span class="mono">${esc(f.world.flags.join(', ') || 'none')}</span></p>
      </div>
    </div>
    <div class="fieldset">
      <h4>Reproduction trace</h4>
      <div class="trace"><ol>${trace}</ol></div>
    </div>
    <div class="fieldset">
      <h4>Required guard patch${f.ref ? ` · ${esc(f.ref)}` : ''}</h4>
      <p class="patch">${esc(f.guardPatch)}</p>
    </div>
  </div>
</article>`;
}

function matrixHtml(t: FaultTable, r: CheckResult): string {
  const faults = t.faults.filter((f) => f.asserts.length || f.clears.length);
  const head = `<tr><th scope="col">fault</th>${t.boundary
    .map((b) => `<th scope="col" title="${esc(b.label)}">${esc(b.id)}</th>`)
    .join('')}</tr>`;
  const rows = faults
    .map((f) => {
      const cells = t.boundary
        .map((b) => {
          const hit = r.findings.some(
            (fd) => fd.ruleId === b.id && fd.faults.length === 1 && fd.faults[0] === f.id,
          );
          return `<td data-hit="${hit}" title="${hit ? 'Conflicts under this single fault' : 'No conflict under this single fault'}">${
            hit ? 'conflict' : '0'
          }</td>`;
        })
        .join('');
      return `<tr><th scope="row" class="rowhead">${esc(f.id)} ${esc(f.label)}</th>${cells}</tr>`;
    })
    .join('');

  return `<section class="panel">
  <div class="panel__head"><h3>Conflict matrix</h3><span class="spacer"></span><span class="note mono">single-fault sweep</span></div>
  <div class="panel__body">
    <p class="note lead-note">Each cell asserts one fault against one boundary rule and lets every downstream transition fire. Fault pairs and triples appear in the findings and in the JSON report.</p>
    <div class="matrix-wrap">
      <table class="matrix">
        <caption>Rows are injected faults, columns are ICD boundary rules.</caption>
        <thead>${head}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</section>`;
}

function ruleTableHtml(t: FaultTable, r: CheckResult): string {
  const rows = t.boundary
    .map((b) => {
      const hit = r.findings.find((f) => f.ruleId === b.id);
      const status = hit
        ? `<span class="sev" data-sev="${hit.severity}">${hit.severity}</span>`
        : `<span class="clean">clean</span>`;
      return `<tr>
        <td class="mono">${esc(b.id)}</td>
        <td class="wide">${esc(b.label)}</td>
        <td class="mono wide">${esc(guardText(b.match))}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join('');
  return `<section class="panel">
  <div class="panel__head"><h3>Rules evaluated</h3><span class="spacer"></span><span class="note mono">${t.boundary.length} rules</span></div>
  <div class="panel__body">
    <div class="matrix-wrap">
      <table class="matrix">
        <thead><tr><th scope="col">id</th><th scope="col">rule</th><th scope="col">match guard</th><th scope="col">result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</section>`;
}

function deadlockHtml(t: FaultTable, r: CheckResult): string {
  if (!r.deadlocks.length) return '';
  const rows = r.deadlocks
    .slice(0, 12)
    .map(
      (d) =>
        `<tr>${t.subsystems
          .map((s) => `<td class="mono">${esc(d.states[s.id] ?? '')}</td>`)
          .join('')}<td class="mono">${esc(d.flags.join(', ') || 'none')}</td></tr>`,
    )
    .join('');
  const more =
    r.deadlocks.length > 12
      ? `<p class="note">${r.deadlocks.length - 12} further absorbing states are listed in the JSON report.</p>`
      : '';
  return `<section class="panel">
  <div class="panel__head"><h3>Absorbing states</h3><span class="spacer"></span><span class="note mono">${r.deadlocks.length}</span></div>
  <div class="panel__body stack">
    <p class="note">Reachable states with no enabled transition in either subsystem. If the vehicle can enter one of these with no ground contact, it needs a hardware reset it does not have.</p>
    <div class="matrix-wrap">
      <table class="matrix">
        <thead><tr>${t.subsystems.map((s) => `<th scope="col">${esc(s.vendor)}</th>`).join('')}<th scope="col">asserted flags</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${more}
  </div>
</section>`;
}

/** The full result block. Safe to inject as innerHTML. */
export function renderResult(t: FaultTable, r: CheckResult): string {
  const findings = sortFindings(r.findings);
  const fail = findings.length > 0;

  const verdict = `<div class="verdict" data-state="${fail ? 'fail' : 'pass'}" role="status">
    <span class="verdict__label">${fail ? 'Blocked' : 'Clear'}</span>
    <span class="verdict__detail">${findings.length} conflict${findings.length === 1 ? '' : 's'} · ${r.counts.critical} critical · ${r.counts.major} major · ${r.counts.minor} minor</span>
    <span class="verdict__detail">${r.combinations} fault combinations</span>
    <span class="verdict__detail">${r.worldsExplored.toLocaleString('en-US')} states explored</span>
    <span class="verdict__detail">${formatDuration(r.durationMs)}</span>
  </div>`;

  const meaning = `<p class="note">${
    fail
      ? 'Each conflict is a reachable cross-subsystem state that neither document covers on its own. The trace is the shortest sequence of legal transitions that produces it.'
      : 'Every rule was evaluated across every fault combination and none became true in a reachable state. That clears the model in this table, not the vehicle.'
  }</p>`;

  const toolbar = `<div class="btn-row" data-toolbar>
    <button type="button" class="btn btn--primary" data-export="md">Export ICD guard patch (.md)</button>
    <button type="button" class="btn btn--ghost" data-export="csv">Export patch sheet (.csv)</button>
    <button type="button" class="btn btn--ghost" data-export="json">Export report (.json)</button>
    <button type="button" class="btn btn--ghost" data-export="copy">Copy Markdown</button>
  </div>
  <p class="note" id="export-status" role="status" aria-live="polite"></p>`;

  const list = fail
    ? `<section aria-labelledby="findings-title" class="findings-block">
        <h2 id="findings-title" class="block-title">Conflicts, worst first</h2>
        <div class="findings">${findings.map((f, i) => findingCard(t, f, i)).join('')}</div>
      </section>`
    : `<div class="empty"><h3>No boundary conflict found</h3><p>All ${t.boundary.length} rules stayed false in every reachable state. Check the rules list below to confirm the table covers the interfaces you care about.</p></div>`;

  return `<div class="result-stack">
    ${verdict}
    ${meaning}
    <div class="result-actions">${toolbar}</div>
    ${list}
    ${matrixHtml(t, r)}
    ${ruleTableHtml(t, r)}
    ${deadlockHtml(t, r)}
  </div>`;
}
