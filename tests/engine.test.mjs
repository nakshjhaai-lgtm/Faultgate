import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.build/shared.test.mjs');
mkdirSync(path.join(root, '.build'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'tools/shared-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  outfile: out,
  logLevel: 'silent',
});
const m = await import(pathToFileURL(out).href);
const { runCheck, parseGuard, tableFromCsv, tableToCsv, tableFromJson, toMarkdown, toPatchCsv, toReportJson } = m;

/** A tiny hand-built table so expectations are readable rather than inherited. */
const mini = {
  name: 'Mini',
  summary: 'Two states on each side, one crossing guard.',
  provenance: 'test fixture',
  revision: 'test-1',
  subsystems: [
    {
      id: 'bus',
      role: 'bus',
      vendor: 'Bus',
      initial: 'UP',
      states: [
        { id: 'UP', label: 'Up' },
        { id: 'DOWN', label: 'Down' },
      ],
      transitions: [
        { from: 'UP', guard: { flag: 'bus.fault' }, to: 'DOWN', effects: [], label: 'trip' },
      ],
    },
    {
      id: 'payload',
      role: 'payload',
      vendor: 'Payload',
      initial: 'IDLE',
      states: [
        { id: 'IDLE', label: 'Idle' },
        { id: 'STUCK', label: 'Stuck' },
      ],
      transitions: [
        { from: 'IDLE', guard: { state: 'bus.DOWN' }, to: 'STUCK', effects: [], label: 'latch' },
      ],
    },
  ],
  faults: [{ id: 'F1', label: 'bus fault', asserts: ['bus.fault'], clears: [] }],
  boundary: [
    {
      id: 'R1',
      label: 'payload stuck',
      severity: 'critical',
      match: { state: 'payload.STUCK' },
      guardPatch: 'guard on bus.UP',
    },
  ],
};

describe('guard parser', () => {
  test('precedence: NOT binds tighter than AND, AND tighter than OR', () => {
    const g = parseGuard('flag(a) OR flag(b) AND NOT flag(c)');
    assert.deepEqual(g, { or: [{ flag: 'a', when: 'set' }, { and: [{ flag: 'b', when: 'set' }, { not: { flag: 'c', when: 'set' } }] }] });
  });

  test('parentheses override precedence', () => {
    const g = parseGuard('(flag(a) OR flag(b)) AND flag(c)');
    assert.equal(g.and.length, 2);
    assert.ok(g.and[0].or);
  });

  test('always() and bare always are equivalent', () => {
    assert.deepEqual(parseGuard('always()'), { always: true });
    assert.deepEqual(parseGuard('ALWAYS'), { always: true });
  });

  test('state predicates are preserved', () => {
    assert.deepEqual(parseGuard('state(bus.RADIO_OFF)'), { state: 'bus.RADIO_OFF' });
  });

  test('rejects trailing garbage instead of silently ignoring it', () => {
    assert.throws(() => parseGuard('flag(a) flag(b)'), /trailing tokens/);
  });

  test('rejects an unclosed call', () => {
    assert.throws(() => parseGuard('flag(a'), /expected rparen/);
  });
});

describe('reachability engine', () => {
  test('finds a rule that only becomes true after a cross-subsystem hop', () => {
    const r = runCheck(mini, { maxFaultDepth: 1 });
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].ruleId, 'R1');
    assert.deepEqual(
      r.findings[0].trace.map((s) => `${s.subsystem}:${s.from}->${s.to}`),
      ['bus:UP->DOWN', 'payload:IDLE->STUCK'],
    );
  });

  test('with no fault injected the rule stays clean', () => {
    const nominal = { ...mini, boundary: mini.boundary };
    const r = runCheck(nominal, { maxFaultDepth: 1 });
    const withoutFault = r.findings.filter((f) => f.faults.length === 0);
    assert.equal(withoutFault.length, 0);
  });

  test('a rule that is unreachable is reported clean, not violated', () => {
    const t = {
      ...mini,
      boundary: [
        ...mini.boundary,
        { id: 'R2', label: 'never happens', severity: 'minor', match: { flag: 'impossible' }, guardPatch: 'none' },
      ],
    };
    const r = runCheck(t, { maxFaultDepth: 1 });
    assert.ok(r.cleanRules.includes('R2'));
    assert.ok(!r.findings.some((f) => f.ruleId === 'R2'));
  });

  test('counts line up with findings', () => {
    const r = runCheck(mini, { maxFaultDepth: 1 });
    const total = r.counts.critical + r.counts.major + r.counts.minor;
    assert.equal(total, r.findings.length);
  });

  test('fault depth controls how many combinations are built', () => {
    const t = { ...mini, faults: ['F1', 'F2', 'F3'].map((id) => ({ id, label: id, asserts: [`x.${id}`], clears: [] })) };
    const d1 = runCheck(t, { maxFaultDepth: 1 });
    const d2 = runCheck(t, { maxFaultDepth: 2 });
    const d3 = runCheck(t, { maxFaultDepth: 3 });
    assert.equal(d1.combinations, 4); // none + 3 singles
    assert.equal(d2.combinations, 7); // + 3 pairs
    assert.equal(d3.combinations, 8); // + 1 triple
  });

  test('terminates on a table with no transitions instead of hanging', () => {
    const t = {
      ...mini,
      subsystems: mini.subsystems.map((s) => ({ ...s, transitions: [] })),
    };
    const r = runCheck(t, { maxFaultDepth: 1 });
    assert.equal(r.findings.length, 0);
  });
});

describe('reference tables', () => {
  for (const id of ['A', 'B', 'C']) {
    test(`template ${id} reports at least one conflict and stays fast`, () => {
      const r = runCheck(m.templates[id], { maxFaultDepth: 3 });
      assert.ok(r.findings.length >= 1, `template ${id} should surface a conflict`);
      assert.ok(r.durationMs < 2000, `template ${id} took ${r.durationMs} ms`);
      // every finding must be fully traceable
      for (const f of r.findings) {
        assert.ok(f.guardPatch.length > 20, 'guard patch must be substantive');
        assert.ok(f.faults.length >= 1 || f.trace.length === 0, 'a finding with no fault needs a seed-state explanation');
        if (f.faults.length) assert.ok(f.trace.length >= 1, 'a faulted finding needs a trace');
      }
    });
  }

  test('template A catches the commissioning radio latch with a single fault', () => {
    const r = runCheck(m.templates.A, { maxFaultDepth: 1 });
    const radio = r.findings.find((f) => f.ruleId === 'BG-01');
    assert.ok(radio, 'the radio latch must be reachable under one fault');
    assert.equal(radio.faults[0], 'F1');
  });
});

describe('CSV import and export', () => {
  test('round-trips every reference table with identical results', () => {
    for (const id of ['A', 'B', 'C']) {
      const t = m.templates[id];
      const back = tableFromCsv(tableToCsv(t), t.name);
      const a = runCheck(t, { maxFaultDepth: 2 });
      const b = runCheck(back, { maxFaultDepth: 2 });
      assert.equal(back.subsystems.length, t.subsystems.length);
      assert.deepEqual(back.subsystems.map((s) => s.states.length), t.subsystems.map((s) => s.states.length));
      assert.deepEqual(back.subsystems.map((s) => s.transitions.length), t.subsystems.map((s) => s.transitions.length));
      assert.deepEqual(back.findings?.length ?? back.boundary.length, t.boundary.length);
      assert.deepEqual(
        a.findings.map((f) => f.ruleId),
        b.findings.map((f) => f.ruleId),
      );
    }
  });

  test('handles quoted fields with commas and doubled quotes', () => {
    // Columns in order: record, subsystem, vendor, role, initial, state, label,
    // from_state, to_state, guard, effects, ref, id, severity, match,
    // guard_patch, asserts, clears.
    const COLS = 18;
    const row = (vals) => {
      const cells = new Array(COLS).fill('');
      for (const [k, v] of Object.entries(vals)) cells[k] = v;
      return cells
        .map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c))
        .join(',');
    };
    const csv = [
      'record,subsystem,vendor,role,initial,state,label,from_state,to_state,guard,effects,ref,id,severity,match,guard_patch,asserts,clears',
      row({ 0: 'meta', 6: 'Name, with comma', 11: 'rev "2"', 15: 'prov, quoted' }),
      row({ 0: 'subsystem', 1: 'bus', 2: 'Vendor, Inc', 3: 'bus', 4: 'UP' }),
      row({ 0: 'state', 1: 'bus', 5: 'UP', 6: 'Up' }),
      row({ 0: 'state', 1: 'bus', 5: 'DOWN', 6: 'Down' }),
      row({ 0: 'transition', 1: 'bus', 6: 'trip, fast', 7: 'UP', 8: 'DOWN', 9: 'flag(f)', 11: 'ref1' }),
      row({ 0: 'fault', 6: 'fault, one', 12: 'F1', 16: 'f' }),
      row({ 0: 'rule', 6: 'rule, one', 12: 'R1', 13: 'critical', 14: 'state(bus.DOWN)', 15: 'patch' }),
    ].join('\n');
    const t = tableFromCsv(csv);
    assert.equal(t.name, 'Name, with comma');
    assert.equal(t.revision, 'rev "2"');
    assert.equal(t.provenance, 'prov, quoted');
    assert.equal(t.subsystems[0].vendor, 'Vendor, Inc');
    assert.equal(t.subsystems[0].transitions[0].label, 'trip, fast');
    assert.deepEqual(t.subsystems[0].transitions[0].guard, { flag: 'f', when: 'set' });
    assert.equal(t.faults[0].label, 'fault, one');
    assert.equal(t.boundary[0].label, 'rule, one');
    assert.equal(t.boundary[0].severity, 'critical');
  });

  test('rejects a transition pointing at an undeclared state', () => {
    const csv = [
      'record,subsystem,vendor,role,initial,state,label,from_state,to_state,guard,effects,ref,id,severity,match,guard_patch,asserts,clears',
      'subsystem,bus,Bus,bus,UP,,,,,,,,,,,',
      'state,bus,,,,UP,Up,,,,,,,,,',
      'transition,bus,,,,,bad,UP,MISSING,always(),,ref,,,,,',
    ].join('\n');
    assert.throws(() => tableFromCsv(csv), /unknown state "MISSING"/);
  });

  test('rejects an unknown record type with the row number', () => {
    const csv = ['record,subsystem', 'subsystem,bus', 'nonsense,bus'].join('\n');
    assert.throws(() => tableFromCsv(csv), /unknown record type "nonsense" on row 3/);
  });

  test('rejects an initial state that was never declared', () => {
    const t = { ...mini, subsystems: [{ ...mini.subsystems[0], initial: 'NOWHERE' }] };
    assert.throws(() => tableFromJson(JSON.stringify(t)), /initial state "NOWHERE"/);
  });

  test('a table with no faults still gets a nominal run', () => {
    const t = tableFromJson(JSON.stringify({ ...mini, faults: [] }));
    assert.equal(t.faults.length, 1);
    assert.equal(t.faults[0].asserts.length, 0);
  });
});

describe('exports', () => {
  const t = m.templates.A;
  const r = runCheck(t, { maxFaultDepth: 2 });

  test('markdown carries revision, provenance, trace and patch for each finding', () => {
    const md = toMarkdown(t, r, new Date('2026-11-07T00:00:00Z'));
    assert.ok(md.includes(t.revision));
    assert.ok(md.includes(t.provenance));
    assert.ok(md.includes('Reproduction trace'));
    assert.ok(md.includes('Required guard patch'));
    for (const f of r.findings) assert.ok(md.includes(f.ruleId), `missing ${f.ruleId}`);
  });

  test('markdown states what a clear result does and does not mean', () => {
    const md = toMarkdown(t, r);
    assert.match(md, /not a proof about the vehicle|not flight clearance|no rule fired/i);
  });

  test('patch CSV has one row per finding plus a header', () => {
    const csv = toPatchCsv(t, r).trim().split('\n');
    assert.equal(csv.length, r.findings.length + 1);
    assert.ok(csv[0].startsWith('rule_id,severity,rule'));
  });

  test('report JSON parses and matches the in-memory result', () => {
    const parsed = JSON.parse(toReportJson(t, r));
    assert.equal(parsed.findings.length, r.findings.length);
    assert.equal(parsed.revision, t.revision);
    assert.equal(parsed.combinations, r.combinations);
  });

  test('finding order is severity first, then id', () => {
    const order = { critical: 0, major: 1, minor: 2 };
    const md = toMarkdown(t, r);
    const ids = [...md.matchAll(/^## \d+\. (BG-\d+)/gm)].map((x) => x[1]);
    const sev = ids.map((id) => t.boundary.find((b) => b.id === id).severity);
    const sorted = [...sev].sort((a, b) => order[a] - order[b]);
    assert.deepEqual(sev, sorted);
  });
});
