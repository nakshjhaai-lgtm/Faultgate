import type { FaultTable } from '../types';

/**
 * Template B: interceptor flight controller + COTS 470 V battery / radar bus.
 *
 * Modelled on the terminal-intercept high-draw case: a BMS protection event
 * during a terminal manoeuvre removes servo power while the flight controller
 * is mid-guidance, and the radar front end's thermal protection mutes the seeker
 * exactly when the guidance law needs it.
 */
export const interceptorHighDraw: FaultTable = {
  name: 'Interceptor flight controller and 470 V battery bus',
  summary:
    'COTS 470 V battery BMS protection against a terminal-guidance flight controller during high-draw intercept.',
  provenance:
    'Structure follows high-voltage COTS battery integration on UGV/UAS/USV platforms (SPM launch, 2026-11-03) and COTS AESA radar thermal protection. Thresholds are illustrative.',
  revision: 'B-2026.11-r2',
  subsystems: [
    {
      id: 'bus',
      role: 'bus',
      vendor: 'Battery management and power distribution',
      initial: 'CRUISE',
      states: [
        { id: 'CRUISE', label: 'Cruise bus (nominal 470 V)' },
        { id: 'ARMED', label: 'Armed: seeker and actuators live' },
        { id: 'OVERCURRENT_PROTECT', label: 'BMS over-current protection open' },
        { id: 'TERMINAL', label: 'Terminal intercept (peak draw)' },
        { id: 'BMS_LOCKOUT', label: 'BMS lockout (manual reset)', terminalHint: true },
        { id: 'RADAR_THERMAL', label: 'Radar front end thermal derate' },
        { id: 'RECOVERY', label: 'Recovery: power restored to actuators', safe: true },
      ],
      transitions: [
        {
          from: 'CRUISE',
          guard: { always: true },
          to: 'ARMED',
          effects: [{ kind: 'set', flag: 'bus.armed' }],
          label: 'Arming sequence closes the actuator contactors',
          ref: 'BMS-PWR-02',
        },
        {
          from: 'ARMED',
          guard: { flag: 'bms.overcurrent' },
          to: 'OVERCURRENT_PROTECT',
          effects: [{ kind: 'set', flag: 'bus.servo_power' }, { kind: 'clear', flag: 'bus.armed' }],
          label: 'Over-current protection opens the servo bus',
          ref: 'BMS-PROT-11',
        },
        {
          from: 'OVERCURRENT_PROTECT',
          guard: { and: [{ not: { flag: 'bms.overcurrent' } }, { flag: 'bms.autoreset' }] },
          to: 'RECOVERY',
          effects: [{ kind: 'clear', flag: 'bus.servo_power' }],
          label: 'Auto-reset controller recloses after the hysteresis window',
          ref: 'BMS-PROT-12',
        },
        {
          from: 'OVERCURRENT_PROTECT',
          guard: { not: { flag: 'bms.autoreset' } },
          to: 'BMS_LOCKOUT',
          effects: [{ kind: 'set', flag: 'bms.locked' }],
          label: 'No auto-reset configured: protection latches for the flight',
          ref: 'BMS-PROT-12',
        },
        {
          from: 'ARMED',
          guard: { and: [{ flag: 'bms.overcurrent' }, { flag: 'bms.autoreset' }] },
          to: 'RECOVERY',
          effects: [{ kind: 'clear', flag: 'bus.armed' }],
          label: 'Armed with auto-reset: protection trips and immediately recloses',
          ref: 'BMS-PROT-12 rev B',
        },
        {
          from: 'ARMED',
          guard: { flag: 'fc.terminal_request' },
          to: 'TERMINAL',
          effects: [{ kind: 'set', flag: 'bus.terminal' }],
          label: 'Flight controller declares terminal intercept',
          ref: 'FC-GNC-40',
        },
        {
          from: 'TERMINAL',
          guard: { flag: 'bms.overcurrent' },
          to: 'OVERCURRENT_PROTECT',
          effects: [{ kind: 'set', flag: 'bus.servo_power' }, { kind: 'clear', flag: 'bus.terminal' }],
          label: 'Terminal peak draw trips over-current protection',
          ref: 'BMS-PROT-11',
        },
        {
          from: 'TERMINAL',
          guard: { flag: 'radar.thermal' },
          to: 'RADAR_THERMAL',
          effects: [{ kind: 'set', flag: 'bus.radar_derate' }],
          label: 'Radar front end derates to protect the AESA panel',
          ref: 'RF-THERM-07',
        },
        {
          from: 'RADAR_THERMAL',
          guard: { not: { flag: 'radar.thermal' } },
          to: 'TERMINAL',
          effects: [{ kind: 'clear', flag: 'bus.radar_derate' }],
          label: 'Panel cools below the derate band, radar returns to full power',
          ref: 'RF-THERM-08',
        },
        {
          from: 'RECOVERY',
          guard: { always: true },
          to: 'ARMED',
          effects: [{ kind: 'set', flag: 'bus.armed' }],
          label: 'Recovery re-arms the platform',
          ref: 'BMS-PWR-09',
        },
        {
          from: 'BMS_LOCKOUT',
          guard: { flag: 'ground.reset' },
          to: 'CRUISE',
          effects: [{ kind: 'clear', flag: 'bms.locked' }],
          label: 'Ground crew manual reset returns the pack to cruise',
          ref: 'BMS-OPS-01',
        },
      ],
    },
    {
      id: 'payload',
      role: 'controller',
      vendor: 'Flight controller and terminal guidance',
      initial: 'NAV',
      states: [
        { id: 'NAV', label: 'Navigation' },
        { id: 'GUIDANCE', label: 'Guidance (seeker tracking)' },
        { id: 'TERMINAL_GUIDANCE', label: 'Terminal guidance (peak servo demand)' },
        { id: 'FAILSAFE', label: 'Failsafe: level and abort', safe: true },
        { id: 'UNCONTROLLED', label: 'No actuator authority', terminalHint: true },
      ],
      transitions: [
        {
          from: 'NAV',
          guard: { flag: 'bus.armed' },
          to: 'GUIDANCE',
          effects: [{ kind: 'set', flag: 'fc.guidance' }],
          label: 'Guidance engages once actuators have power',
          ref: 'FC-GNC-12',
        },
        {
          from: 'GUIDANCE',
          guard: { and: [{ flag: 'seeker.lock' }, { not: { flag: 'bus.radar_derate' } }] },
          to: 'TERMINAL_GUIDANCE',
          effects: [{ kind: 'set', flag: 'fc.terminal_request' }],
          label: 'Seeker lock with a healthy radar declares terminal',
          ref: 'FC-GNC-40',
        },
        {
          from: 'TERMINAL_GUIDANCE',
          guard: { flag: 'bms.overcurrent' },
          to: 'UNCONTROLLED',
          effects: [{ kind: 'set', flag: 'fc.no_authority' }],
          label: 'Servo power lost at terminal: guidance has no authority',
          ref: 'FC-GNC-44',
        },
        {
          from: 'TERMINAL_GUIDANCE',
          guard: { flag: 'bus.radar_derate' },
          to: 'FAILSAFE',
          effects: [{ kind: 'clear', flag: 'fc.terminal_request' }],
          label: 'Radar derate drops the track and the controller fails safe',
          ref: 'FC-GNC-45',
        },
        {
          from: 'GUIDANCE',
          guard: { flag: 'bus.servo_power' },
          to: 'FAILSAFE',
          effects: [{ kind: 'clear', flag: 'fc.guidance' }],
          label: 'Servo bus open: controller fails safe',
          ref: 'FC-GNC-31',
        },
        {
          from: 'FAILSAFE',
          guard: { not: { flag: 'bus.servo_power' } },
          to: 'UNCONTROLLED',
          effects: [{ kind: 'set', flag: 'fc.no_authority' }],
          label: 'Failsafe without servo power degrades to uncontrolled',
          ref: 'FC-GNC-33',
        },
        {
          from: 'FAILSAFE',
          guard: { and: [{ not: { flag: 'bus.servo_power' } }, { flag: 'bus.radar_derate' }] },
          to: 'NAV',
          effects: [{ kind: 'clear', flag: 'fc.guidance' }],
          label: 'Failsafe recovers to navigation with the radar derated',
          ref: 'FC-GNC-34',
        },
      ],
    },
  ],
  faults: [
    { id: 'F1', label: 'Terminal peak draw trips BMS over-current', asserts: ['bms.overcurrent'], clears: [], ref: 'BMS-PROT-11' },
    { id: 'F2', label: 'BMS auto-reset configured', asserts: ['bms.autoreset'], clears: [], ref: 'BMS-PROT-12' },
    { id: 'F3', label: 'AESA panel exceeds thermal derate band', asserts: ['radar.thermal'], clears: [], ref: 'RF-THERM-07' },
    { id: 'F4', label: 'Seeker lock acquired', asserts: ['seeker.lock'], clears: [], ref: 'RF-SEEK-03' },
    { id: 'F5', label: 'Ground crew reset available', asserts: ['ground.reset'], clears: [], ref: 'BMS-OPS-01' },
  ],
  boundary: [
    {
      id: 'BG-01',
      label: 'Intercept flown with no actuator authority after BMS latch',
      severity: 'critical',
      match: { and: [{ state: 'bus.BMS_LOCKOUT' }, { state: 'payload.UNCONTROLLED' }] },
      guardPatch:
        'Make the terminal-guidance branch conditional on (bus.bms.auto_reset == ENABLED) OR (bus.bms.headroom > 25 %). Set the over-current auto-reset hysteresis to 400 ms and require a documented abort-to-failsafe path before terminal commit.',
      ref: 'FC-GNC-44 / BMS-PROT-12',
    },
    {
      id: 'BG-02',
      label: 'Guidance holding terminal authority with radar derated',
      severity: 'major',
      match: { and: [{ state: 'bus.RADAR_THERMAL' }, { state: 'payload.TERMINAL_GUIDANCE' }] },
      guardPatch:
        'Interlock: TERMINAL_GUIDANCE requires (bus.radar_state == NOMINAL). Publish the derate flag at least 20 ms before the panel mutes so the guidance law can hand over to inertial coasting instead of dropping track.',
      ref: 'RF-THERM-07 / FC-GNC-45',
    },
    {
      id: 'BG-03',
      label: 'Terminal commit while the pack is already in protection',
      severity: 'critical',
      match: { and: [{ state: 'bus.OVERCURRENT_PROTECT' }, { state: 'payload.TERMINAL_GUIDANCE' }] },
      guardPatch:
        'Add a pre-commit check: terminal commit is rejected unless the BMS reports PROTECTION_CLEAR for 500 ms. Raise the transient over-current limit for the terminal window only, with a hard energy budget.',
      ref: 'BMS-PROT-11 / FC-GNC-40',
    },
    {
      id: 'BG-04',
      label: 'Failsafe entered with the servo bus still open',
      severity: 'minor',
      match: { and: [{ state: 'payload.FAILSAFE' }, { state: 'bus.OVERCURRENT_PROTECT' }] },
      guardPatch:
        'Failsafe must command a zero-authority glide and a controlled descent when servo power is unavailable, rather than holding altitude. Surface BMS state on the failsafe annunciator.',
      ref: 'FC-GNC-31',
    },
  ],
};
