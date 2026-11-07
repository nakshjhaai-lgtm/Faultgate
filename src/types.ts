/**
 * FaultGate core types.
 *
 * The model is deliberately small: two subsystems (a host vehicle bus and a
 * payload / autonomy controller) each described as a finite state machine,
 * plus the cross-system coupling rules that only exist at the boundary
 * between them. Everything the tool reports is derived from these four
 * things and nothing else.
 */

/** A guard tree. Guards are evaluated against the *current* global state. */
export type Guard =
  | { always: true }
  | { flag: string; when?: 'set' | 'clear' }
  /** Predicate on one subsystem's current state, written "bus.RADIO_OFF". */
  | { state: string }
  | { not: Guard }
  | { and: Guard[] }
  | { or: Guard[] };

export type Effect =
  | { kind: 'set'; flag: string }
  | { kind: 'clear'; flag: string };

export interface Transition {
  /** Source state id within the owning subsystem. */
  from: string;
  /** Guard evaluated against the global (subsystem.fsm.state + flags) world. */
  guard: Guard;
  /** Destination state id within the owning subsystem. */
  to: string;
  /** Flags set or cleared when this transition fires. */
  effects: Effect[];
  /** Short human explanation, shown in trace and patch output. */
  label: string;
  /** Free-form provenance, e.g. "BUS-FDIR-14 rev C". */
  ref?: string;
}

export interface StateNode {
  id: string;
  label: string;
  /**
   * True when nothing in the owning subsystem can leave this state on its own.
   * An absorbing state is only a finding when no *other* subsystem can break
   * the lock either, which is what reachability proves.
   */
  terminalHint?: boolean;
  /** Marks states that represent the vehicle's intended safe behaviour. */
  safe?: boolean;
}

export interface Subsystem {
  id: string;
  role: 'bus' | 'payload' | 'controller';
  vendor: string;
  states: StateNode[];
  initial: string;
  transitions: Transition[];
}

/** One fault the verifier will inject, exactly like a real bus FDIR table row. */
export interface Fault {
  id: string;
  label: string;
  /** Flags asserted while the fault is active. */
  asserts: string[];
  /** Flags withdrawn when the fault clears. */
  clears: string[];
  /** Optional ref into the source ICD / FDIR table. */
  ref?: string;
}

/**
 * A rule that is only true when both subsystems are considered together. This
 * is the class of requirement that gets lost when bus and payload ICDs are
 * reviewed independently.
 */
export interface BoundaryRule {
  id: string;
  label: string;
  /** The finding only matters if the world can reach a state matching this. */
  match: Guard;
  severity: 'critical' | 'major' | 'minor';
  /** What to do about it, phrased as an ICD guard patch. */
  guardPatch: string;
  ref?: string;
}

export interface FaultTable {
  name: string;
  /** One-line description shown in the template picker. */
  summary: string;
  /** Where the numbers in this table come from, printed in the ICD export. */
  provenance: string;
  revision: string;
  subsystems: Subsystem[];
  faults: Fault[];
  boundary: BoundaryRule[];
}

/** A concrete global configuration: one state per subsystem plus the flags. */
export interface World {
  states: Record<string, string>;
  flags: string[];
}

export interface Step {
  faultId: string;
  subsystem: string;
  transitionIndex: number;
  from: string;
  to: string;
  label: string;
  ref?: string;
  effects: Effect[];
}

export interface Finding {
  ruleId: string;
  ruleLabel: string;
  severity: 'critical' | 'major' | 'minor';
  guardPatch: string;
  ref?: string;
  /** The fault set that was active when the finding was reached. */
  faults: string[];
  /** Ordered transitions from the seed state to the violating state. */
  trace: Step[];
  /** Flag set at the point of violation, for the UI. */
  world: World;
}

export interface CheckResult {
  table: string;
  revision: string;
  /** Wall-clock duration of the whole check. */
  durationMs: number;
  /** Number of worlds explored. */
  worldsExplored: number;
  /** Number of single- and dual-fault combinations run. */
  combinations: number;
  findings: Finding[];
  /** Rules that were evaluated and never violated. */
  cleanRules: string[];
  /** Rules whose guard tree never became true in any reachable world. */
  unreachableRules: string[];
  /** Absorbing worlds: no transition in either subsystem is enabled. */
  deadlocks: World[];
  counts: Record<string, number>;
}
