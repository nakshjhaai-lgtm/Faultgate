import type { FaultTable } from '../types';

/**
 * Template A: orbital bus + onboard autonomy safety kernel.
 *
 * Modelled on the failure chain reported for Otter 24C on 2026-11-04: a
 * third-party bus fault-protection rule turned the radio off during
 * commissioning, and no autonomous watchdog path existed to turn it back on.
 * State names and rule ids are invented for the demo; the structure follows a
 * conventional FDIR table layout.
 */
export const commissioningRadioCutoff: FaultTable = {
  name: 'Commissioning radio-cutoff and safety kernel',
  summary:
    'Orbital bus FDIR against an onboard autonomy safety kernel during commissioning and shadow-mode handoff.',
  provenance:
    'Structure follows the Otter 24C commissioning loss reported 2026-11-04 (bus fault protection removed the radio link). States and thresholds are illustrative.',
  revision: 'A-2026.11-r3',
  subsystems: [
    {
      id: 'bus',
      role: 'bus',
      vendor: 'Host vehicle bus FDIR',
      initial: 'COMMISSIONING',
      states: [
        { id: 'COMMISSIONING', label: 'Commissioning (radio commanded)' },
        { id: 'RADIO_ON', label: 'Radio transceiver on' },
        { id: 'RADIO_OFF', label: 'Radio transceiver off', terminalHint: true },
        { id: 'WATCHDOG_ARMED', label: 'Radio watchdog armed (auto-restore)', safe: true },
        { id: 'POWER_SHED', label: 'Power shed: non-critical loads off' },
        { id: 'SAFE_MODE', label: 'Bus safe mode (sun-point, beacon only)' },
        { id: 'LATCHED_FAULT', label: 'Bus latched fault (ground intervention)', terminalHint: true },
      ],
      transitions: [
        {
          from: 'COMMISSIONING',
          guard: { always: true },
          to: 'RADIO_ON',
          effects: [{ kind: 'set', flag: 'radio.enabled' }],
          label: 'Commissioning window opens the transceiver',
          ref: 'BUS-FDIR-01',
        },
        {
          from: 'RADIO_ON',
          guard: { flag: 'bus.uv_trip' },
          to: 'RADIO_OFF',
          effects: [{ kind: 'clear', flag: 'radio.enabled' }],
          label: 'Under-voltage trip removes non-essential load (radio)',
          ref: 'BUS-FDIR-14',
        },
        {
          from: 'RADIO_ON',
          guard: { and: [{ flag: 'bus.uv_trip' }, { flag: 'watchdog.enabled' }] },
          to: 'WATCHDOG_ARMED',
          effects: [{ kind: 'clear', flag: 'radio.enabled' }],
          label: 'Under-voltage trip with watchdog: arm restore timer instead of latching',
          ref: 'BUS-FDIR-14 rev C',
        },
        {
          from: 'WATCHDOG_ARMED',
          guard: { not: { flag: 'watchdog.expired' } },
          to: 'RADIO_ON',
          effects: [{ kind: 'set', flag: 'radio.enabled' }],
          label: 'Watchdog expiry restores the radio link',
          ref: 'BUS-FDIR-15',
        },
        {
          from: 'WATCHDOG_ARMED',
          guard: { flag: 'watchdog.expired' },
          to: 'RADIO_OFF',
          effects: [{ kind: 'clear', flag: 'radio.enabled' }],
          label: 'Watchdog already expired: restore suppressed, radio stays off',
          ref: 'BUS-FDIR-15',
        },
        {
          from: 'RADIO_ON',
          guard: { flag: 'thermal.trip' },
          to: 'POWER_SHED',
          effects: [{ kind: 'set', flag: 'power.shed' }],
          label: 'Thermal trip sheds payload power budget',
          ref: 'BUS-FDIR-22',
        },
        {
          from: 'POWER_SHED',
          guard: { not: { flag: 'thermal.trip' } },
          to: 'RADIO_ON',
          effects: [{ kind: 'clear', flag: 'power.shed' }],
          label: 'Thermal recovery restores the full power budget',
          ref: 'BUS-FDIR-23',
        },
        {
          from: 'RADIO_ON',
          guard: { flag: 'seu.latched' },
          to: 'SAFE_MODE',
          effects: [{ kind: 'set', flag: 'bus.safe' }],
          label: 'Single-event upset forces bus safe mode',
          ref: 'BUS-FDIR-31',
        },
        {
          from: 'SAFE_MODE',
          guard: { not: { flag: 'seu.latched' } },
          to: 'RADIO_OFF',
          effects: [{ kind: 'set', flag: 'bus.safe' }],
          label: 'Safe mode parks the radio until ground intervention',
          ref: 'BUS-FDIR-33',
        },
        {
          from: 'COMMISSIONING',
          guard: { flag: 'telemetry.stale' },
          to: 'SAFE_MODE',
          effects: [{ kind: 'set', flag: 'bus.safe' }],
          label: 'Stale telemetry blocks commissioning and falls back to safe mode',
          ref: 'BUS-FDIR-08',
        },
        {
          from: 'POWER_SHED',
          guard: { flag: 'seu.latched' },
          to: 'LATCHED_FAULT',
          effects: [{ kind: 'set', flag: 'bus.latched' }],
          label: 'Upset while shed: fault latch closes for the rest of the pass',
          ref: 'BUS-FDIR-35',
        },
        {
          from: 'RADIO_OFF',
          guard: { flag: 'ground.uplink' },
          to: 'COMMISSIONING',
          effects: [{ kind: 'clear', flag: 'bus.latched' }],
          label: 'Ground uplink reopens commissioning',
          ref: 'BUS-OPS-02',
        },
      ],
    },
    {
      id: 'payload',
      role: 'payload',
      vendor: 'Onboard autonomy safety kernel',
      initial: 'KERNEL_IDLE',
      states: [
        { id: 'KERNEL_IDLE', label: 'Kernel idle' },
        { id: 'SHADOW_MODE', label: 'Shadow mode (observe, do not command)', safe: true },
        { id: 'CMD_TRANSLATE', label: 'Translating autonomy plan to commands' },
        { id: 'SAFETY_HOLD', label: 'Safety hold (kernel gate closed)' },
        { id: 'KERNEL_LOCKOUT', label: 'Kernel lockout', terminalHint: true },
      ],
      transitions: [
        {
          from: 'KERNEL_IDLE',
          guard: { state: 'bus.COMMISSIONING' },
          to: 'SHADOW_MODE',
          effects: [{ kind: 'set', flag: 'kernel.shadow' }],
          label: 'Kernel enters shadow mode during commissioning',
          ref: 'PAY-SK-04',
        },
        {
          from: 'SHADOW_MODE',
          guard: { and: [{ flag: 'radio.enabled' }, { not: { flag: 'telemetry.stale' } }] },
          to: 'CMD_TRANSLATE',
          effects: [{ kind: 'clear', flag: 'kernel.shadow' }],
          label: 'Shadow mode promotes to commanding once the link is healthy',
          ref: 'PAY-SK-09',
        },
        {
          from: 'CMD_TRANSLATE',
          guard: { flag: 'telemetry.stale' },
          to: 'SAFETY_HOLD',
          effects: [{ kind: 'set', flag: 'kernel.hold' }],
          label: 'Stale state estimate closes the kernel gate',
          ref: 'PAY-SK-12',
        },
        {
          from: 'CMD_TRANSLATE',
          guard: { flag: 'payload.high_draw' },
          to: 'SAFETY_HOLD',
          effects: [{ kind: 'set', flag: 'kernel.hold' }],
          label: 'Autonomy high-draw command exceeds envelope, held',
          ref: 'PAY-SK-13',
        },
        {
          from: 'SAFETY_HOLD',
          guard: { and: [{ not: { flag: 'telemetry.stale' } }, { not: { flag: 'payload.high_draw' } }] },
          to: 'SHADOW_MODE',
          effects: [{ kind: 'clear', flag: 'kernel.hold' }],
          label: 'Hold releases back to shadow mode',
          ref: 'PAY-SK-14',
        },
        {
          from: 'SAFETY_HOLD',
          guard: { state: 'bus.LATCHED_FAULT' },
          to: 'KERNEL_LOCKOUT',
          effects: [{ kind: 'set', flag: 'kernel.lockout' }],
          label: 'Kernel latches when the bus latches (shared inhibit line)',
          ref: 'PAY-SK-21',
        },
        {
          from: 'CMD_TRANSLATE',
          guard: { state: 'bus.SAFE_MODE' },
          to: 'SAFETY_HOLD',
          effects: [{ kind: 'set', flag: 'kernel.hold' }],
          label: 'Bus safe mode withdraws kernel commanding authority',
          ref: 'PAY-SK-16',
        },
        {
          from: 'SHADOW_MODE',
          guard: { state: 'bus.RADIO_OFF' },
          to: 'KERNEL_LOCKOUT',
          effects: [{ kind: 'set', flag: 'kernel.lockout' }],
          label: 'Kernel has no command path with radio off and locks out',
          ref: 'PAY-SK-18',
        },
      ],
    },
  ],
  faults: [
    {
      id: 'F1',
      label: 'Bus under-voltage trip during commissioning',
      asserts: ['bus.uv_trip'],
      clears: [],
      ref: 'BUS-FDIR-14',
    },
    {
      id: 'F2',
      label: 'Radio watchdog timer already expired',
      asserts: ['watchdog.expired'],
      clears: ['watchdog.enabled'],
      ref: 'BUS-FDIR-15',
    },
    {
      id: 'F3',
      label: 'Autonomy commanding outside power envelope',
      asserts: ['payload.high_draw'],
      clears: [],
      ref: 'PAY-SK-13',
    },
    {
      id: 'F4',
      label: 'Telemetry staleness during pass',
      asserts: ['telemetry.stale'],
      clears: [],
      ref: 'BUS-FDIR-08',
    },
    {
      id: 'F5',
      label: 'Single-event upset latched in bus controller',
      asserts: ['seu.latched'],
      clears: [],
      ref: 'BUS-FDIR-31',
    },
    {
      id: 'F6',
      label: 'Radiator thermal trip',
      asserts: ['thermal.trip'],
      clears: [],
      ref: 'BUS-FDIR-22',
    },
    {
      id: 'F7',
      label: 'Ground uplink acquired (recovery available)',
      asserts: ['ground.uplink'],
      clears: [],
      ref: 'BUS-OPS-02',
    },
    {
      id: 'F8',
      label: 'Watchdog recovery timer enabled',
      asserts: ['watchdog.enabled'],
      clears: [],
      ref: 'BUS-FDIR-14 rev C',
    },
  ],
  boundary: [
    {
      id: 'BG-01',
      label: 'Radio latched off with no autonomous restore path',
      severity: 'critical',
      match: {
        and: [
          { state: 'bus.RADIO_OFF' },
          { not: { flag: 'watchdog.enabled' } },
          { not: { flag: 'ground.uplink' } },
        ],
      },
      guardPatch:
        'Guard CARGO-COMMAND and every payload downlink on (bus.radio.enabled == true) AND arm the radio restore watchdog before the first under-voltage trip can assert. Minimum hysteresis: 250 ms above the UV threshold before re-enabling the transceiver.',
      ref: 'BUS-FDIR-14 / PAY-SK-09',
    },
    {
      id: 'BG-02',
      label: 'Safety kernel locked out while the bus is still commissioned',
      severity: 'critical',
      match: { state: 'payload.KERNEL_LOCKOUT' },
      guardPatch:
        'Remove the shared inhibit line between bus fault latch and kernel lockout, or require an explicit ground-signed release before the kernel may enter KERNEL_LOCKOUT. Kernel lockout must never be reachable from a bus-side latch alone.',
      ref: 'PAY-SK-18 / PAY-SK-21',
    },
    {
      id: 'BG-03',
      label: 'Kernel commanding while the bus reports safe mode',
      severity: 'major',
      match: { and: [{ state: 'bus.SAFE_MODE' }, { state: 'payload.CMD_TRANSLATE' }] },
      guardPatch:
        'Gate the command translator on (bus.mode != SAFE_MODE). On a safe-mode entry, the kernel must be forced to SAFETY_HOLD within one control period (10 ms) before the next command envelope is assembled.',
      ref: 'PAY-SK-16',
    },
    {
      id: 'BG-04',
      label: 'Power shed with the kernel still commanding high draw',
      severity: 'major',
      match: { and: [{ state: 'bus.POWER_SHED' }, { state: 'payload.CMD_TRANSLATE' }, { flag: 'payload.high_draw' }] },
      guardPatch:
        'Publish the shed budget as a bus flag and require the kernel to clamp its envelope to the shed budget within 50 ms of power.shed asserting. Reject any autonomy plan whose declared draw exceeds the published budget.',
      ref: 'BUS-FDIR-22 / PAY-SK-13',
    },
    {
      id: 'BG-05',
      label: 'Telemetry stale while the kernel holds commanding authority',
      severity: 'minor',
      match: { and: [{ flag: 'telemetry.stale' }, { state: 'payload.CMD_TRANSLATE' }] },
      guardPatch:
        'Bound the state-estimate age at 2 s for commanding authority. Beyond it, the kernel drops to SAFETY_HOLD; the kernel may only re-arm after three consecutive fresh estimates.',
      ref: 'BUS-FDIR-08 / PAY-SK-12',
    },
  ],
};
