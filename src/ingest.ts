import type { Effect, FaultTable, Guard, StateNode, Subsystem, Transition } from './types';

/**
 * Guard expression parser.
 *
 * The CSV format has to be typeable by a human in a spreadsheet, so guards use
 * a tiny prefix-expression language rather than JSON:
 *
 *   flag(bus.uv_trip) AND NOT flag(watchdog.enabled)
 *   state(bus.RADIO_OFF) OR flag(ground.uplink)
 *   always()
 *
 * Precedence is NOT > AND > OR, parentheses allowed, case-insensitive keywords.
 */
type Tok = { t: 'ident' | 'lparen' | 'rparen' | 'comma' | 'and' | 'or' | 'not'; v: string };

function tokenize(input: string): Tok[] {
  const out: Tok[] = [];
  const re = /[A-Za-z_][A-Za-z0-9_.\-]*|[(),]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const raw = m[0];
    if (raw === '(') out.push({ t: 'lparen', v: raw });
    else if (raw === ')') out.push({ t: 'rparen', v: raw });
    else if (raw === ',') out.push({ t: 'comma', v: raw });
    else {
      const low = raw.toLowerCase();
      if (low === 'and') out.push({ t: 'and', v: raw });
      else if (low === 'or') out.push({ t: 'or', v: raw });
      else if (low === 'not') out.push({ t: 'not', v: raw });
      else out.push({ t: 'ident', v: raw });
    }
  }
  return out;
}

export function parseGuard(input: string): Guard {
  const toks = tokenize(input);
  let i = 0;
  const peek = () => toks[i];
  const eat = (t: Tok['t']) => {
    const tok = toks[i];
    if (!tok || tok.t !== t) throw new Error(`guard parse: expected ${t} near token ${i}`);
    i++;
    return tok;
  };

  function parseOr(): Guard {
    const parts = [parseAnd()];
    while (peek()?.t === 'or') {
      i++;
      parts.push(parseAnd());
    }
    return parts.length === 1 ? parts[0] : { or: parts };
  }
  function parseAnd(): Guard {
    const parts = [parseNot()];
    while (peek()?.t === 'and') {
      i++;
      parts.push(parseNot());
    }
    return parts.length === 1 ? parts[0] : { and: parts };
  }
  function parseNot(): Guard {
    if (peek()?.t === 'not') {
      i++;
      return { not: parseNot() };
    }
    return parseAtom();
  }
  function parseAtom(): Guard {
    const tok = peek();
    if (!tok) throw new Error('guard parse: unexpected end of input');
    if (tok.t === 'lparen') {
      i++;
      const inner = parseOr();
      eat('rparen');
      return inner;
    }
    if (tok.t === 'ident') {
      i++;
      const name = tok.v.toLowerCase();
      if (name === 'always') {
        // tolerate always() or bare always
        if (peek()?.t === 'lparen') {
          i++;
          eat('rparen');
        }
        return { always: true };
      }
      if (name === 'flag' || name === 'state') {
        eat('lparen');
        const arg = eat('ident').v;
        eat('rparen');
        if (name === 'flag') {
          // flag(x) defaults to "set"; flag(!x) is not expressible, use NOT.
          return { flag: arg, when: 'set' };
        }
        return { state: arg };
      }
      // Bare identifier is treated as a flag name.
      return { flag: tok.v, when: 'set' };
    }
    throw new Error(`guard parse: unexpected token "${tok.v}"`);
  }

  const g = parseOr();
  if (i !== toks.length) throw new Error(`guard parse: trailing tokens from index ${i}`);
  return g;
}

/** "+a,-b" -> effects. */
export function parseEffects(input: string): Effect[] {
  return input
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const set = s.startsWith('+');
      const clear = s.startsWith('-');
      if (!set && !clear) throw new Error(`effects: "${s}" must start with + or -`);
      return { kind: set ? 'set' : 'clear', flag: s.slice(1).trim() } as Effect;
    });
}

/**
 * Minimal RFC-4180 CSV reader. Handles quoted fields, embedded commas and
 * doubled quotes; ignores blank lines.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const lower = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Reads the single-file CSV format. The first column names the record type so
 * one file can carry the whole table:
 *
 *   record,subsystem,vendor,role,initial,state,label,from_state,to_state,guard,effects,ref,id,severity,match,guard_patch,asserts,clears
 *
 * Only the columns relevant to each record type are read; unknown columns are
 * ignored, which keeps hand-edited spreadsheets from breaking the import.
 */
export function tableFromCsv(text: string, fallbackName = 'Imported fault table'): FaultTable {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV import: need a header row and at least one record');
  const header = rows[0].map(lower);
  const col = (r: string[], name: string) => {
    const idx = header.indexOf(name);
    return idx === -1 ? '' : (r[idx] ?? '').trim();
  };

  const subsystems = new Map<string, Subsystem>();
  const statesBySub = new Map<string, StateNode[]>();
  const transitionsBySub = new Map<string, Transition[]>();
  const faults: FaultTable['faults'] = [];
  const boundary: FaultTable['boundary'] = [];
  let name = '';
  let revision = '';
  let provenance = '';
  let summary = '';

  const ensureSub = (id: string): Subsystem => {
    let s = subsystems.get(id);
    if (!s) {
      s = {
        id,
        role: 'bus',
        vendor: id,
        initial: '',
        states: [],
        transitions: [],
      };
      subsystems.set(id, s);
      statesBySub.set(id, []);
      transitionsBySub.set(id, []);
    }
    return s;
  };

  for (const r of rows.slice(1)) {
    const rec = col(r, 'record').toLowerCase();
    switch (rec) {
      case 'meta':
        name = col(r, 'label') || name;
        revision = col(r, 'ref') || revision;
        provenance = col(r, 'guard_patch') || provenance;
        summary = col(r, 'match') || summary;
        break;
      case 'subsystem': {
        const id = col(r, 'subsystem');
        if (!id) throw new Error('CSV import: subsystem record without a subsystem id');
        const s = ensureSub(id);
        s.vendor = col(r, 'vendor') || s.vendor;
        const role = col(r, 'role') as Subsystem['role'];
        if (role === 'bus' || role === 'payload' || role === 'controller') s.role = role;
        s.initial = col(r, 'initial') || s.initial;
        break;
      }
      case 'state': {
        const id = col(r, 'subsystem');
        const stateId = col(r, 'state');
        if (!id || !stateId) throw new Error('CSV import: state record needs subsystem and state');
        ensureSub(id);
        statesBySub.get(id)!.push({
          id: stateId,
          label: col(r, 'label') || stateId,
          terminalHint: lower(col(r, 'effects')) === 'terminal',
          safe: lower(col(r, 'effects')) === 'safe',
        });
        break;
      }
      case 'transition': {
        const id = col(r, 'subsystem');
        const from = col(r, 'from_state');
        const to = col(r, 'to_state');
        if (!id || !from || !to) {
          throw new Error('CSV import: transition record needs subsystem, from_state and to_state');
        }
        ensureSub(id);
        const guardText = col(r, 'guard') || 'always()';
        transitionsBySub.get(id)!.push({
          from,
          to,
          guard: parseGuard(guardText),
          effects: parseEffects(col(r, 'effects')),
          label: col(r, 'label') || `${from} to ${to}`,
          ref: col(r, 'ref') || undefined,
        });
        break;
      }
      case 'fault': {
        const fid = col(r, 'id');
        if (!fid) throw new Error('CSV import: fault record needs an id');
        faults.push({
          id: fid,
          label: col(r, 'label') || fid,
          asserts: col(r, 'asserts').split(/[,;]/).map((s) => s.trim()).filter(Boolean),
          clears: col(r, 'clears').split(/[,;]/).map((s) => s.trim()).filter(Boolean),
          ref: col(r, 'ref') || undefined,
        });
        break;
      }
      case 'rule': {
        const rid = col(r, 'id');
        if (!rid) throw new Error('CSV import: rule record needs an id');
        const sev = lower(col(r, 'severity'));
        boundary.push({
          id: rid,
          label: col(r, 'label') || rid,
          severity: sev === 'critical' || sev === 'minor' ? sev : 'major',
          match: parseGuard(col(r, 'match') || 'always()'),
          guardPatch: col(r, 'guard_patch') || '',
          ref: col(r, 'ref') || undefined,
        });
        break;
      }
      case '':
      case 'comment':
        break;
      default:
        throw new Error(`CSV import: unknown record type "${rec}" on row ${rows.indexOf(r) + 1}`);
    }
  }

  for (const [id, s] of subsystems) {
    s.states = statesBySub.get(id) ?? [];
    s.transitions = transitionsBySub.get(id) ?? [];
    if (!s.initial) s.initial = s.states[0]?.id ?? '';
    if (s.states.length === 0) throw new Error(`CSV import: subsystem "${id}" has no states`);
    if (!s.initial) throw new Error(`CSV import: subsystem "${id}" has no initial state`);
    const ids = new Set(s.states.map((x) => x.id));
    for (const t of s.transitions) {
      if (!ids.has(t.from)) throw new Error(`CSV import: ${id} transition from unknown state "${t.from}"`);
      if (!ids.has(t.to)) throw new Error(`CSV import: ${id} transition to unknown state "${t.to}"`);
    }
  }

  return normalize({
    name: name || fallbackName,
    summary: summary || 'Imported from CSV',
    provenance: provenance || 'Imported by the operator; no provenance recorded.',
    revision: revision || 'imported',
    subsystems: [...subsystems.values()],
    faults,
    boundary,
  });
}

export function tableFromJson(text: string): FaultTable {
  const raw = JSON.parse(text) as FaultTable;
  if (!raw || !Array.isArray(raw.subsystems) || raw.subsystems.length === 0) {
    throw new Error('JSON import: expected a "subsystems" array');
  }
  return normalize({
    name: raw.name || 'Imported fault table',
    summary: raw.summary || 'Imported from JSON',
    provenance: raw.provenance || 'Imported by the operator; no provenance recorded.',
    revision: raw.revision || 'imported',
    subsystems: raw.subsystems,
    faults: raw.faults ?? [],
    boundary: raw.boundary ?? [],
  });
}

/** Structural validation shared by both importers. */
function normalize(t: FaultTable): FaultTable {
  for (const s of t.subsystems) {
    const ids = new Set(s.states.map((x) => x.id));
    if (!ids.has(s.initial)) throw new Error(`"${s.id}": initial state "${s.initial}" is not declared`);
    for (const tr of s.transitions) {
      if (!ids.has(tr.from)) throw new Error(`"${s.id}": transition from undeclared state "${tr.from}"`);
      if (!ids.has(tr.to)) throw new Error(`"${s.id}": transition to undeclared state "${tr.to}"`);
    }
  }
  if (t.faults.length === 0) {
    t.faults = [{ id: 'F0', label: 'No fault injected (nominal run)', asserts: [], clears: [] }];
  }
  return t;
}

/** Serialises a table back to the CSV interchange format (round-trip safe). */
export function tableToCsv(t: FaultTable): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: string[][] = [
    [
      'record', 'subsystem', 'vendor', 'role', 'initial', 'state', 'label', 'from_state',
      'to_state', 'guard', 'effects', 'ref', 'id', 'severity', 'match', 'guard_patch',
      'asserts', 'clears',
    ],
  ];
  const blank = (n: number) => new Array(n).fill('');
  const row = (vals: Record<string, string>) => {
    const base = blank(18);
    for (const [k, v] of Object.entries(vals)) {
      const i = rows[0].indexOf(k);
      if (i >= 0) base[i] = v;
    }
    rows.push(base);
  };

  row({ record: 'meta', label: t.name, ref: t.revision, guard_patch: t.provenance, match: t.summary });
  for (const s of t.subsystems) {
    row({ record: 'subsystem', subsystem: s.id, vendor: s.vendor, role: s.role, initial: s.initial });
    for (const st of s.states) {
      row({
        record: 'state',
        subsystem: s.id,
        state: st.id,
        label: st.label,
        effects: st.safe ? 'safe' : st.terminalHint ? 'terminal' : '',
      });
    }
    for (const tr of s.transitions) {
      row({
        record: 'transition',
        subsystem: s.id,
        from_state: tr.from,
        to_state: tr.to,
        guard: guardToText(tr.guard),
        effects: tr.effects.map((e) => `${e.kind === 'set' ? '+' : '-'}${e.flag}`).join(','),
        label: tr.label,
        ref: tr.ref ?? '',
      });
    }
  }
  for (const f of t.faults) {
    row({
      record: 'fault',
      id: f.id,
      label: f.label,
      asserts: f.asserts.join(','),
      clears: f.clears.join(','),
      ref: f.ref ?? '',
    });
  }
  for (const b of t.boundary) {
    row({
      record: 'rule',
      id: b.id,
      label: b.label,
      severity: b.severity,
      match: guardToText(b.match),
      guard_patch: b.guardPatch,
      ref: b.ref ?? '',
    });
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}

export function guardToText(g: Guard): string {
  if ('always' in g) return 'always()';
  if ('flag' in g) return `flag(${g.flag})`;
  if ('state' in g) return `state(${g.state})`;
  if ('not' in g) {
    const inner = guardToText(g.not);
    return inner.includes(' AND ') || inner.includes(' OR ') ? `NOT (${inner})` : `NOT ${inner}`;
  }
  if ('and' in g) return g.and.map((x) => wrap(x, 'AND')).join(' AND ');
  if ('or' in g) return g.or.map((x) => wrap(x, 'OR')).join(' OR ');
  return 'always()';
}

const wrap = (g: Guard, parent: 'AND' | 'OR') => {
  const txt = guardToText(g);
  const needs = parent === 'AND' ? txt.includes(' OR ') : false;
  return needs ? `(${txt})` : txt;
};
