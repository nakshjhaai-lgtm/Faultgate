import type { CheckResult, Finding, FaultTable } from './types';
import { traceLines } from './engine';
import { guardToText } from './ingest';

const SEVERITY_ORDER = { critical: 0, major: 1, minor: 2 } as const;

/** Sub-second results read as milliseconds; anything longer as seconds. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export const sortFindings = (f: Finding[]): Finding[] =>
  [...f].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));

const stateLabel = (t: FaultTable, subId: string, stateId: string) => {
  const sub = t.subsystems.find((s) => s.id === subId);
  return sub?.states.find((s) => s.id === stateId)?.label ?? stateId;
};

export function faultLabel(t: FaultTable, id: string): string {
  return t.faults.find((f) => f.id === id)?.label ?? id;
}

/**
 * Markdown ICD guard-condition patch sheet. This is the deliverable that goes
 * into the interface control document review, so it carries the reproduction
 * trace for every finding rather than only the conclusion.
 */
export function toMarkdown(t: FaultTable, r: CheckResult, generatedAt = new Date()): string {
  const iso = generatedAt.toISOString();
  const findings = sortFindings(r.findings);
  const lines: string[] = [];

  lines.push(`# ICD guard-condition patch sheet`);
  lines.push('');
  lines.push(`**Table:** ${t.name}  `);
  lines.push(`**Revision:** ${t.revision}  `);
  lines.push(`**Generated:** ${iso}  `);
  lines.push(`**Provenance:** ${t.provenance}`);
  lines.push('');
  lines.push(
    `**Result:** ${findings.length === 0 ? 'no boundary conflicts found' : `${findings.length} boundary conflict${findings.length === 1 ? '' : 's'}`} across ${r.combinations} fault combinations and ${r.worldsExplored.toLocaleString('en-US')} reachable states. Check took ${formatDuration(r.durationMs)}.`,
  );
  lines.push('');
  lines.push('| severity | count |');
  lines.push('| --- | --- |');
  for (const sev of ['critical', 'major', 'minor'] as const) {
    lines.push(`| ${sev} | ${r.counts[sev] ?? 0} |`);
  }
  lines.push('');

  if (findings.length === 0) {
    lines.push('Every boundary rule in this table was evaluated and none became true in a reachable state.');
    lines.push('This is a result about the model, not a proof about the vehicle: it is only as complete as the transitions and faults that were entered.');
    lines.push('');
  }

  findings.forEach((f, i) => {
    lines.push(`## ${i + 1}. ${f.ruleId}: ${f.ruleLabel}`);
    lines.push('');
    lines.push(`**Severity:** ${f.severity}  `);
    if (f.ref) lines.push(`**Interface reference:** ${f.ref}  `);
    lines.push(`**Triggering fault set:** ${f.faults.length ? f.faults.map((id) => `${id} (${faultLabel(t, id)})`).join(' + ') : 'none, the seeded state already violates the rule'}`);
    lines.push('');
    lines.push('**Conflicting world:**');
    lines.push('');
    for (const s of t.subsystems) {
      lines.push(`- ${s.vendor}: \`${f.world.states[s.id]}\` (${stateLabel(t, s.id, f.world.states[s.id])})`);
    }
    const flags = f.world.flags.filter(Boolean);
    lines.push(`- asserted flags: ${flags.length ? flags.map((x) => `\`${x}\``).join(', ') : 'none'}`);
    lines.push('');
    lines.push('**Reproduction trace:**');
    lines.push('');
    lines.push('```');
    for (const l of traceLines(f)) lines.push(l);
    lines.push('```');
    lines.push('');
    lines.push('**Required guard patch:**');
    lines.push('');
    lines.push(`> ${f.guardPatch}`);
    lines.push('');
  });

  if (r.deadlocks.length) {
    lines.push('## Absorbing states');
    lines.push('');
    lines.push(
      `${r.deadlocks.length} reachable ${r.deadlocks.length === 1 ? 'state has' : 'states have'} no enabled transition in either subsystem. An absorbing state with no ground path is unrecoverable without a hardware reset, which is not available in flight.`,
    );
    lines.push('');
    lines.push('| bus state | controller state | asserted flags |');
    lines.push('| --- | --- | --- |');
    for (const d of r.deadlocks.slice(0, 20)) {
      const cells = t.subsystems.map((s) => `\`${d.states[s.id]}\``);
      lines.push(`| ${cells.join(' | ')} | ${d.flags.join(', ') || 'none'} |`);
    }
    if (r.deadlocks.length > 20) lines.push(`| … ${r.deadlocks.length - 20} more | | |`);
    lines.push('');
  }

  lines.push('## Rules evaluated with no conflict');
  lines.push('');
  if (r.cleanRules.length === 0) lines.push('None.');
  else for (const id of r.cleanRules) {
    const rule = t.boundary.find((b) => b.id === id);
    lines.push(`- ${id}${rule ? `: ${rule.label}` : ''}`);
  }
  lines.push('');

  lines.push('## How to read this sheet');
  lines.push('');
  lines.push(
    'Each finding names the fault set, the exact cross-subsystem state, and the ordered transitions that reach it. The guard patch is written as an interface condition so it can be applied to the busy-payload or autonomy side without editing host bus firmware.',
  );
  lines.push('');
  lines.push(
    'A clean result means no rule fired for the transitions and faults in this table. Add any unmodelled transition before treating a clean result as flight clearance.',
  );
  lines.push('');
  return lines.join('\n');
}

/** CSV patch sheet, one row per finding, for pasting into a tracking sheet. */
export function toPatchCsv(t: FaultTable, r: CheckResult): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    'rule_id',
    'severity',
    'rule',
    'interface_ref',
    'fault_set',
    'bus_state',
    'controller_state',
    'asserted_flags',
    'reproduction_trace',
    'required_guard_patch',
  ];
  const rows = [header];
  for (const f of sortFindings(r.findings)) {
    const bus = t.subsystems[0];
    const ctrl = t.subsystems[1] ?? t.subsystems[0];
    rows.push([
      f.ruleId,
      f.severity,
      f.ruleLabel,
      f.ref ?? '',
      f.faults.join('+') || 'none',
      f.world.states[bus.id] ?? '',
      f.world.states[ctrl.id] ?? '',
      f.world.flags.join(' '),
      f.trace.map((s) => `${s.subsystem}:${s.from}->${s.to}`).join('; ') || 'seed state',
      f.guardPatch,
    ]);
  }
  return rows.map((row) => row.map(esc).join(',')).join('\n') + '\n';
}

/** Full JSON report, for CI or for handing to another tool. */
export function toReportJson(t: FaultTable, r: CheckResult): string {
  return JSON.stringify(
    {
      table: t.name,
      revision: t.revision,
      provenance: t.provenance,
      generatedAt: new Date().toISOString(),
      durationMs: Math.round(r.durationMs * 100) / 100,
      combinations: r.combinations,
      worldsExplored: r.worldsExplored,
      counts: r.counts,
      findings: sortFindings(r.findings).map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        label: f.ruleLabel,
        ref: f.ref,
        faults: f.faults,
        world: f.world,
        trace: f.trace,
        guardPatch: f.guardPatch,
      })),
      deadlocks: r.deadlocks,
      cleanRules: r.cleanRules,
    },
    null,
    2,
  );
}

export const guardText = guardToText;
