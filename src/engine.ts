import type {
  BoundaryRule,
  CheckResult,
  Effect,
  Fault,
  FaultTable,
  Finding,
  Guard,
  Step,
  Subsystem,
  World,
} from './types';

const key = (w: World) => {
  // Stable, order-independent world key for the visited set.
  const s = Object.keys(w.states)
    .sort()
    .map((k) => `${k}=${w.states[k]}`)
    .join('|');
  return `${s}#${[...w.flags].sort().join(',')}`;
};

export function evalGuard(g: Guard, w: World): boolean {
  if ('always' in g) return true;
  if ('flag' in g) {
    const set = w.flags.includes(g.flag);
    return (g.when ?? 'set') === 'set' ? set : !set;
  }
  if ('state' in g) {
    const [sub, state] = g.state.split('.');
    return w.states[sub] === state;
  }
  if ('not' in g) return !evalGuard(g.not, w);
  if ('and' in g) return g.and.every((x) => evalGuard(x, w));
  if ('or' in g) return g.or.some((x) => evalGuard(x, w));
  return false;
}

function applyEffects(flags: Set<string>, effects: Effect[]): Set<string> {
  const next = new Set(flags);
  for (const e of effects) {
    if (e.kind === 'set') next.add(e.flag);
    else next.delete(e.flag);
  }
  return next;
}

/**
 * Evaluates a boundary rule. Rules may reference whole-world flags directly, or
 * use the "@state" shorthand scoped to a subsystem, which this resolves.
 */
export function evalRule(rule: BoundaryRule, table: FaultTable, w: World): boolean {
  return evalGuard(rule.match, w);
}

interface Enabled {
  sub: Subsystem;
  index: number;
}

function enabledTransitions(table: FaultTable, w: World): Enabled[] {
  const out: Enabled[] = [];
  for (const sub of table.subsystems) {
    const here = w.states[sub.id];
    sub.transitions.forEach((t, index) => {
      if (t.from !== here) return;
      if (evalGuard(t.guard, w)) out.push({ sub, index });
    });
  }
  return out;
}

/** Apply one fault (assert its flags). Faults are held for the whole search. */
function withFaults(base: World, faults: Fault[]): World {
  const flags = new Set(base.flags);
  for (const f of faults) {
    for (const a of f.asserts) flags.add(a);
    for (const c of f.clears) flags.delete(c);
  }
  return { states: { ...base.states }, flags: [...flags] };
}

export interface CheckOptions {
  /** Hard cap on explored worlds so a pathological table cannot hang the tab. */
  maxWorlds?: number;
  /** Maximum fault count per combination. 1 = single fault, 2 = single + dual. */
  maxFaultDepth?: 1 | 2;
}

export function runCheck(table: FaultTable, opts: CheckOptions = {}): CheckResult {
  const started = performance.now();
  const maxWorlds = opts.maxWorlds ?? 20000;
  const maxDepth = opts.maxFaultDepth ?? 3;

  // Seed world: every subsystem in its declared initial state, no flags.
  const seed: World = {
    states: Object.fromEntries(table.subsystems.map((s) => [s.id, s.initial])),
    flags: [],
  };

  // Fault combinations: the empty set (nominal), then every subset up to
  // maxDepth. Combinations are what a commissioning review never has time to
  // enumerate by hand, so this is the part that earns the time saving.
  const combos: Fault[][] = [[]];
  const addCombos = (start: number, picked: Fault[]) => {
    if (picked.length === maxDepth) return;
    for (let i = start; i < table.faults.length; i++) {
      const next = [...picked, table.faults[i]];
      combos.push(next);
      addCombos(i + 1, next);
    }
  };
  addCombos(0, []);

  const findings: Finding[] = [];
  const violated = new Set<string>();
  const fired = new Set<string>();
  const deadlocks: World[] = [];
  let worldsExplored = 0;

  for (const combo of combos) {
    const root = withFaults(seed, combo);
    const visited = new Set<string>([key(root)]);
    // BFS carrying the path, so the first time a rule trips we have the
    // shortest fault-propagation trace that reproduces it.
    const queue: { world: World; path: Step[] }[] = [{ world: root, path: [] }];
    let head = 0;

    while (head < queue.length && worldsExplored < maxWorlds) {
      const { world, path } = queue[head++];
      worldsExplored++;

      for (const rule of table.boundary) {
        if (evalRule(rule, table, world)) {
          if (!violated.has(rule.id)) {
            violated.add(rule.id);
            findings.push({
              ruleId: rule.id,
              ruleLabel: rule.label,
              severity: rule.severity,
              guardPatch: rule.guardPatch,
              ref: rule.ref,
              faults: combo.map((f) => f.id),
              trace: path,
              world,
            });
          }
          // Guard reached: never expand through a state the ICD says must not
          // exist, so one rule cannot mask another behind it.
          continue;
        }
      }

      const enabled = enabledTransitions(table, world);
      if (enabled.length === 0) {
        if (path.length > 0) deadlocks.push(world);
        continue;
      }

      for (const { sub, index } of enabled) {
        const t = sub.transitions[index];
        const nextFlags = applyEffects(new Set(world.flags), t.effects);
        const next: World = {
          states: { ...world.states, [sub.id]: t.to },
          flags: [...nextFlags],
        };
        const k = key(next);
        if (visited.has(k)) continue;
        visited.add(k);
        fired.add(`${sub.id}:${index}`);
        queue.push({
          world: next,
          path: [
            ...path,
            {
              faultId: combo.map((f) => f.id).join('+') || 'none',
              subsystem: sub.id,
              transitionIndex: index,
              from: t.from,
              to: t.to,
              label: t.label,
              ref: t.ref,
              effects: t.effects,
            },
          ],
        });
      }
    }

    if (worldsExplored >= maxWorlds) break;
  }

  const counts: Record<string, number> = { critical: 0, major: 0, minor: 0 };
  for (const f of findings) counts[f.severity]++;

  return {
    table: table.name,
    revision: table.revision,
    durationMs: Math.max(0, performance.now() - started),
    worldsExplored,
    combinations: combos.length,
    findings,
    cleanRules: table.boundary.filter((r) => !violated.has(r.id)).map((r) => r.id),
    unreachableRules: table.boundary.filter((r) => !violated.has(r.id)).map((r) => r.id),
    deadlocks,
    counts,
  };
}

/** Human-readable rendering of a finding's trace, used by the exporter. */
export function traceLines(f: Finding): string[] {
  const lines: string[] = [];
  const faultText = f.faults.length ? f.faults.join(' + ') : 'no injected fault';
  lines.push(`fault set: ${faultText}`);
  if (f.trace.length === 0) {
    lines.push('  seed state already violates the rule (static conflict)');
  }
  f.trace.forEach((s, i) => {
    const eff =
      s.effects.length === 0
        ? ''
        : ` [${s.effects
            .map((e) => `${e.kind === 'set' ? '+' : '-'}${e.flag}`)
            .join(' ')}]`;
    lines.push(`  ${String(i + 1).padStart(2)} ${s.subsystem}: ${s.from} -> ${s.to}  ${s.label}${eff}`);
  });
  return lines;
}
