import type { FaultTable } from '../types';

/**
 * Template C: reentry stage + cryogenic / thermal valve controller.
 *
 * Modelled on chilldown and plasma-blackout conflicts: the valve controller
 * wants a sequencer lock during plasma blackout, while the stage sequencer wants
 * to keep burning; and a chilldown complete signal that is only valid after the
 * sensor has been warmed, which conflicts with an early-abort rule.
 */
export const reentryValveConflict: FaultTable = {
  name: 'Reentry stage and cryogenic valve controller',
  summary:
    'Stage sequencer against a cryogenic valve controller across chilldown, plasma blackout and thermal protection.',
  provenance:
    'Structure follows liquid-propulsion chilldown sequencing and reentry plasma-blackout telemetry loss on 2026 reentry vehicles. Thresholds are illustrative.',
  revision: 'C-2026.11-r1',
  subsystems: [
    {
      id: 'bus',
      role: 'bus',
      vendor: 'Stage sequencer and thermal protection',
      initial: 'PRELAUNCH',
      states: [
        { id: 'PRELAUNCH', label: 'Pre-launch' },
        { id: 'CHILLDOWN', label: 'Chilldown in progress' },
        { id: 'ASCENT', label: 'Ascent burn' },
        { id: 'BLACKOUT', label: 'Plasma blackout (comms lost)' },
        { id: 'THERMAL_PROTECT', label: 'Thermal protection active' },
        { id: 'STAGE_SAFED', label: 'Stage safed (valves closed, no restart)', terminalHint: true },
        { id: 'RECOVERY', label: 'Recovery: vent and safe', safe: true },
      ],
      transitions: [
        {
          from: 'PRELAUNCH',
          guard: { always: true },
          to: 'CHILLDOWN',
          effects: [{ kind: 'set', flag: 'bus.chilldown' }],
          label: 'Sequencer starts chilldown',
          ref: 'SEQ-01',
        },
        {
          from: 'CHILLDOWN',
          guard: { and: [{ flag: 'valve.chill_complete' }, { not: { flag: 'valve.sensor_fault' } }] },
          to: 'ASCENT',
          effects: [{ kind: 'clear', flag: 'bus.chilldown' }, { kind: 'set', flag: 'bus.burning' }],
          label: 'Chilldown complete and sensors healthy: ignition',
          ref: 'SEQ-05',
        },
        {
          from: 'CHILLDOWN',
          guard: { flag: 'valve.sensor_fault' },
          to: 'STAGE_SAFED',
          effects: [{ kind: 'set', flag: 'bus.safed' }],
          label: 'Sensor fault during chilldown safes the stage',
          ref: 'SEQ-06',
        },
        {
          from: 'ASCENT',
          guard: { flag: 'bus.blackout' },
          to: 'BLACKOUT',
          effects: [{ kind: 'set', flag: 'bus.comms_lost' }],
          label: 'Plasma sheath opens: comms and uplink lost',
          ref: 'SEQ-11',
        },
        {
          from: 'BLACKOUT',
          guard: { not: { flag: 'bus.blackout' } },
          to: 'ASCENT',
          effects: [{ kind: 'clear', flag: 'bus.comms_lost' }],
          label: 'Blackout clears, comms restored',
          ref: 'SEQ-12',
        },
        {
          from: 'BLACKOUT',
          guard: { flag: 'valve.overpressure' },
          to: 'THERMAL_PROTECT',
          effects: [{ kind: 'set', flag: 'bus.thermal' }],
          label: 'Overpressure during blackout enters thermal protection',
          ref: 'SEQ-14',
        },
        {
          from: 'ASCENT',
          guard: { flag: 'valve.overpressure' },
          to: 'THERMAL_PROTECT',
          effects: [{ kind: 'set', flag: 'bus.thermal' }],
          label: 'Overpressure trips thermal protection',
          ref: 'SEQ-13',
        },
        {
          from: 'THERMAL_PROTECT',
          guard: { and: [{ not: { flag: 'valve.overpressure' } }, { not: { flag: 'bus.blackout' } }] },
          to: 'RECOVERY',
          effects: [{ kind: 'clear', flag: 'bus.thermal' }],
          label: 'Pressure recovers, stage vents and safes',
          ref: 'SEQ-15',
        },
        {
          from: 'THERMAL_PROTECT',
          guard: { flag: 'bus.blackout' },
          to: 'STAGE_SAFED',
          effects: [{ kind: 'set', flag: 'bus.safed' }],
          label: 'Thermal protection through blackout: stage safes without telemetry',
          ref: 'SEQ-16',
        },
        {
          from: 'ASCENT',
          guard: { flag: 'seq.abort' },
          to: 'STAGE_SAFED',
          effects: [{ kind: 'set', flag: 'bus.safed' }],
          label: 'Range abort safes the stage',
          ref: 'SEQ-20',
        },
      ],
    },
    {
      id: 'payload',
      role: 'controller',
      vendor: 'Cryogenic valve controller',
      initial: 'VALVE_CLOSED',
      states: [
        { id: 'VALVE_CLOSED', label: 'Valves closed, controller idle' },
        { id: 'CHILL_SEQUENCE', label: 'Chilldown valve sequence running' },
        { id: 'VALVE_OPEN', label: 'Main valves open' },
        { id: 'SEQUENCER_LOCK', label: 'Sequencer lock (waits for ground)' },
        { id: 'VALVE_LATCHED', label: 'Valve latched closed', terminalHint: true },
      ],
      transitions: [
        {
          from: 'VALVE_CLOSED',
          guard: { flag: 'bus.chilldown' },
          to: 'CHILL_SEQUENCE',
          effects: [{ kind: 'set', flag: 'valve.sequencing' }],
          label: 'Controller follows the sequencer into chilldown',
          ref: 'VC-02',
        },
        {
          from: 'CHILL_SEQUENCE',
          guard: { flag: 'valve.cold' },
          to: 'VALVE_OPEN',
          effects: [{ kind: 'set', flag: 'valve.chill_complete' }, { kind: 'clear', flag: 'valve.sequencing' }],
          label: 'Cold temperature reached: open main valves',
          ref: 'VC-05',
        },
        {
          from: 'CHILL_SEQUENCE',
          guard: { flag: 'valve.sensor_fault' },
          to: 'VALVE_LATCHED',
          effects: [{ kind: 'set', flag: 'valve.latched' }],
          label: 'Sensor fault latches the valve closed',
          ref: 'VC-06',
        },
        {
          from: 'VALVE_OPEN',
          guard: { flag: 'valve.cold' },
          to: 'VALVE_OPEN',
          effects: [],
          label: 'Hold-open loop: valve stays open while cold (self-loop)',
          ref: 'VC-07',
        },
        {
          from: 'VALVE_OPEN',
          guard: { flag: 'bus.comms_lost' },
          to: 'SEQUENCER_LOCK',
          effects: [{ kind: 'set', flag: 'valve.locked' }],
          label: 'Comms lost: valve controller locks the sequencer pending ground',
          ref: 'VC-11',
        },
        {
          from: 'SEQUENCER_LOCK',
          guard: { not: { flag: 'bus.comms_lost' } },
          to: 'VALVE_OPEN',
          effects: [{ kind: 'clear', flag: 'valve.locked' }],
          label: 'Comms restored: sequencer lock releases',
          ref: 'VC-12',
        },
        {
          from: 'SEQUENCER_LOCK',
          guard: { flag: 'bus.thermal' },
          to: 'VALVE_LATCHED',
          effects: [{ kind: 'set', flag: 'valve.latched' }],
          label: 'Thermal protection during lock latches the valve closed',
          ref: 'VC-13',
        },
        {
          from: 'VALVE_OPEN',
          guard: { flag: 'bus.safed' },
          to: 'VALVE_CLOSED',
          effects: [{ kind: 'clear', flag: 'valve.latched' }],
          label: 'Stage safing closes the main valves',
          ref: 'VC-15',
        },
      ],
    },
  ],
  faults: [
    { id: 'F1', label: 'Chilldown cold-trap threshold reached', asserts: ['valve.cold'], clears: [], ref: 'VC-05' },
    { id: 'F2', label: 'Chilldown sensor fault (thermocouple open)', asserts: ['valve.sensor_fault'], clears: [], ref: 'VC-06' },
    { id: 'F3', label: 'Plasma blackout envelope', asserts: ['bus.blackout'], clears: [], ref: 'SEQ-11' },
    { id: 'F4', label: 'Valve overpressure transient', asserts: ['valve.overpressure'], clears: [], ref: 'SEQ-13' },
    { id: 'F5', label: 'Range abort command', asserts: ['seq.abort'], clears: [], ref: 'SEQ-20' },
  ],
  boundary: [
    {
      id: 'BG-01',
      label: 'Stage safed through plasma blackout with no telemetry to recover',
      severity: 'critical',
      match: { and: [{ state: 'bus.STAGE_SAFED' }, { flag: 'bus.comms_lost' }] },
      guardPatch:
        'Make stage safing unreachable while bus.comms_lost is true; require either a comms-restored edge or a hard timeout of 90 s after blackout exit. Persist the safing reason to non-volatile memory so it survives the blackout.',
      ref: 'SEQ-16',
    },
    {
      id: 'BG-02',
      label: 'Valve controller latched closed while the sequencer still expects a burn',
      severity: 'critical',
      match: { and: [{ state: 'payload.VALVE_LATCHED' }, { state: 'bus.ASCENT' }] },
      guardPatch:
        'Publish valve.latched to the sequencer as a burn-inhibit flag. The ascent state must transition to SAFED within 20 ms of valve.latched asserting, and the sequencer must never command a burn with valves latched.',
      ref: 'VC-06 / SEQ-05',
    },
    {
      id: 'BG-03',
      label: 'Sequencer lock held while the stage is already safed',
      severity: 'major',
      match: { and: [{ state: 'payload.SEQUENCER_LOCK' }, { state: 'bus.STAGE_SAFED' }] },
      guardPatch:
        'Auto-release the sequencer lock on the stage-safed edge. Ground clearance must not be a precondition for releasing a lock on a stage that can no longer fire.',
      ref: 'VC-11',
    },
    {
      id: 'BG-04',
      label: 'Thermal protection active with valves closed (no vent path)',
      severity: 'major',
      match: { and: [{ state: 'bus.THERMAL_PROTECT' }, { state: 'payload.VALVE_CLOSED' }] },
      guardPatch:
        'Require a vent path whenever thermal protection is active: on entry, command the relief valve open for at least 5 s before any further safing action.',
      ref: 'SEQ-13',
    },
  ],
};
