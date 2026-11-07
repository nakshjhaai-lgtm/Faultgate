export { runCheck } from '../src/engine';
export { tableToCsv, tableFromCsv, tableFromJson, parseGuard, guardToText } from '../src/ingest';
export { toMarkdown, toPatchCsv, toReportJson, formatDuration } from '../src/export';
export { renderResult } from '../src/render';
export { commissioningRadioCutoff } from '../data/template-a';
export { interceptorHighDraw } from '../data/template-b';
export { reentryValveConflict } from '../data/template-c';
import * as a from '../data/template-a';
import * as b from '../data/template-b';
import * as c from '../data/template-c';
export const templates = {
  A: a.commissioningRadioCutoff,
  B: b.interceptorHighDraw,
  C: c.reentryValveConflict,
};
