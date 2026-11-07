import { commissioningRadioCutoff } from './template-a';
import { interceptorHighDraw } from './template-b';
import { reentryValveConflict } from './template-c';
import type { FaultTable } from '../types';

/** The three reference tables, keyed by the picker id. */
export const templates: Record<'A' | 'B' | 'C', FaultTable> = {
  A: commissioningRadioCutoff,
  B: interceptorHighDraw,
  C: reentryValveConflict,
};
