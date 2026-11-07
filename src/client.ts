import { runCheck } from './engine';
import { tableFromCsv, tableFromJson } from './ingest';
import { toMarkdown, toPatchCsv, toReportJson } from './export';
import { renderResult } from './render';
import { templates } from '../data/templates';
import type { CheckResult, FaultTable } from './types';

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;

const state = {
  active: 'A' as string,
  table: null as FaultTable | null,
  result: null as CheckResult | null,
  busy: false,
};

/* ---------------------------------------------------------------- theme -- */
const THEME_KEY = 'faultgate.theme';

function applyTheme(mode: string) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

function describeTheme(mode: string) {
  return mode === 'system' ? 'follow system' : mode;
}

function initTheme() {
  let mode = 'system';
  try {
    mode = localStorage.getItem(THEME_KEY) ?? 'system';
  } catch {
    /* storage can be blocked; system default is correct */
  }
  applyTheme(mode);
  const btn = $<HTMLButtonElement>('#theme');
  const text = btn ? $('.theme-toggle__text', btn) : null;
  const sync = () => {
    if (text) text.textContent = mode === 'system' ? 'Auto' : mode === 'dark' ? 'Dark' : 'Light';
    btn?.setAttribute('aria-label', `Colour theme: ${describeTheme(mode)}. Activate to change.`);
  };
  sync();
  btn?.addEventListener('click', () => {
    mode = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* non-fatal */
    }
    applyTheme(mode);
    sync();
  });
}

/* --------------------------------------------------------------- tables -- */
const kinds = (t: FaultTable) =>
  `${t.subsystems.reduce((n, s) => n + s.states.length, 0)} states / ${t.subsystems.reduce(
    (n, s) => n + s.transitions.length,
    0,
  )} transitions / ${t.faults.length} faults / ${t.boundary.length} rules`;

function selectTemplate(id: string, run: boolean) {
  const t = (templates as Record<string, FaultTable>)[id];
  if (!t) return;
  state.active = id;
  state.table = t;
  for (const el of document.querySelectorAll<HTMLElement>('.tpl')) {
    el.setAttribute('aria-pressed', String(el.dataset.tpl === id));
  }
  const chosen = $('#chosen');
  if (chosen) {
    chosen.innerHTML = `<p class="note"><strong>${escapeHtml(t.name)}</strong> · revision <span class="mono">${escapeHtml(
      t.revision,
    )}</span>. ${escapeHtml(t.summary)}</p><p class="note">Provenance: ${escapeHtml(t.provenance)}</p>`;
  }
  const url = new URL(location.href);
  if (id === 'A') url.searchParams.delete('tpl');
  else url.searchParams.set('tpl', id);
  url.searchParams.delete('table');
  history.replaceState(null, '', url);
  if (run) void runNow();
}

function initPicker() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.tpl')) {
    btn.addEventListener('click', () => selectTemplate(btn.dataset.tpl ?? 'A', true));
  }
}

/* --------------------------------------------------------------- errors -- */
function showError(message: string, hint?: string) {
  const host = $('#error');
  if (!host) return;
  host.classList.remove('hide');
  host.innerHTML = `<div class="alert" role="alert">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" class="alert__icon">
      <path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <path d="M8 6v4.2" stroke="currentColor" stroke-width="1.4"/>
      <circle cx="8" cy="11.9" r=".85" fill="currentColor"/>
    </svg>
    <div><strong>Import rejected.</strong> ${escapeHtml(message.trim())}.${
      hint
        ? `<p class="note tight pad-top-sm">${escapeHtml(hint)}</p>`
        : ''
    }</div>
  </div>`;
}

function clearError() {
  const host = $('#error');
  if (host) {
    host.classList.add('hide');
    host.innerHTML = '';
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/* ------------------------------------------------------------------ run -- */
const SHOW_DELAY = 120;
const MIN_VISIBLE = 320;

async function runNow() {
  if (state.busy || !state.table) return;
  clearError();
  state.busy = true;

  const btn = $<HTMLButtonElement>('#run');
  const label = btn ? $('.btn__label', btn) : null;
  let shownAt = 0;
  let timer: number | undefined;

  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (label) label.textContent = 'Running boundary check…';
    timer = window.setTimeout(() => {
      btn.dataset.loading = 'true';
      shownAt = performance.now();
    }, SHOW_DELAY);
  }

  // Let the loading state paint before the synchronous search blocks the thread.
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  let result: CheckResult | null = null;
  try {
    result = runCheck(state.table, { maxFaultDepth: 3 });
    state.result = result;
  } catch (err) {
    showError(
      err instanceof Error ? err.message : String(err),
      'This is a defect in the verifier, not in your table: the table already passed the importer.',
    );
  }

  if (shownAt) {
    const elapsed = performance.now() - shownAt;
    if (elapsed < MIN_VISIBLE) await new Promise((r) => setTimeout(r, MIN_VISIBLE - elapsed));
  }
  if (timer) clearTimeout(timer);
  if (btn) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.dataset.loading = 'false';
    if (label) label.textContent = 'Run boundary check';
  }
  state.busy = false;

  if (result) paint(result);
}

function paint(result: CheckResult) {
  const host = $('#result');
  if (!host || !state.table) return;
  host.innerHTML = renderResult(state.table, result);
  wireExports();
  announce(
    result.findings.length
      ? `Check complete. ${result.findings.length} boundary conflicts found.`
      : 'Check complete. No boundary conflict found.',
  );
  host.scrollIntoView({ block: 'nearest', behavior: prefersReduced() ? 'auto' : 'smooth' });
}

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function announce(msg: string) {
  const el = document.getElementById('export-status');
  if (el) el.textContent = msg;
}

function wireExports() {
  const t = state.table;
  const r = state.result;
  if (!t || !r) return;
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  const find = (kind: string) => $(`[data-export="${kind}"]`);
  find('md')?.addEventListener('click', () => {
    download(`faultgate-icd-patch-${stamp()}.md`, toMarkdown(t, r), 'text/markdown');
    announce('Markdown patch sheet downloaded.');
  });
  find('csv')?.addEventListener('click', () => {
    download(`faultgate-patch-${stamp()}.csv`, toPatchCsv(t, r), 'text/csv');
    announce('CSV patch sheet downloaded.');
  });
  find('json')?.addEventListener('click', () => {
    download(`faultgate-report-${stamp()}.json`, toReportJson(t, r), 'application/json');
    announce('JSON report downloaded.');
  });
  const copy = find('copy');
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(t, r));
      copy.textContent = 'Copied';
      announce('Markdown copied to the clipboard.');
      setTimeout(() => (copy.textContent = 'Copy Markdown'), 1800);
    } catch {
      announce('The browser blocked clipboard access. Use “Export ICD guard patch (.md)” instead.');
    }
  });
}

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* --------------------------------------------------------------- import -- */
const SIZE_LIMIT = 2 * 1024 * 1024;

async function handleFiles(files: FileList | File[]) {
  const file = files[0];
  if (!file) return;
  const name = file.name.toLowerCase();

  if (file.size > SIZE_LIMIT) {
    showError(
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the 2 MB limit.`,
      'A fault table is a few kilobytes. Check that you picked the table and not a log archive.',
    );
    return;
  }
  if (!/\.(csv|json|txt)$/.test(name)) {
    showError(
      `${file.name} is not a .csv or .json file.`,
      'Export the FDIR table as CSV with the columns on the schema page, or use the JSON form.',
    );
    return;
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    showError(
      `The browser could not read ${file.name}.`,
      'If the file lives on a network drive, copy it locally and drop it again.',
    );
    return;
  }

  try {
    const table = name.endsWith('.json')
      ? tableFromJson(text)
      : tableFromCsv(text, file.name.replace(/\.[^.]+$/, ''));
    clearError();
    state.active = 'custom';
    state.table = table;
    state.result = null;
    for (const el of document.querySelectorAll<HTMLElement>('.tpl')) el.setAttribute('aria-pressed', 'false');
    const chosen = $('#chosen');
    if (chosen) {
      chosen.innerHTML = `<p class="note"><strong>${escapeHtml(table.name)}</strong> · imported from <span class="mono">${escapeHtml(
        file.name,
      )}</span> (${kinds(table)}).</p><p class="note">Provenance: ${escapeHtml(table.provenance)}</p>`;
    }
    const url = new URL(location.href);
    url.searchParams.delete('tpl');
    url.searchParams.set('table', file.name);
    history.replaceState(null, '', url);
    void runNow();
  } catch (err) {
    showError(
      err instanceof Error ? err.message : String(err),
      'One record per row. Expected record types: meta, subsystem, state, transition, fault, rule.',
    );
  }
}

function initDrop() {
  const zone = $('#drop');
  const input = $<HTMLInputElement>('#file');
  if (!zone || !input) return;

  for (const ev of ['dragenter', 'dragover'] as const) {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.dataset.over = 'true';
    });
  }
  for (const ev of ['dragleave', 'drop'] as const) {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.dataset.over = 'false';
    });
  }
  zone.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt?.files?.length) void handleFiles(dt.files);
  });
  input.addEventListener('change', () => {
    if (input.files?.length) void handleFiles(input.files);
    input.value = '';
  });
  $('#browse')?.addEventListener('click', () => input.click());

  $('#download-sample')?.addEventListener('click', async () => {
    const id = state.active !== 'custom' ? state.active : 'A';
    try {
      const res = await fetch(`/templates/${id}.csv`);
      if (!res.ok) throw new Error(String(res.status));
      download(`faultgate-template-${id}.csv`, await res.text(), 'text/csv');
      announce(`Template ${id} downloaded as CSV. Edit it in a spreadsheet and drop it back here.`);
    } catch {
      showError('The template CSV could not be fetched.', 'Reload the page and try again.');
    }
  });
}

function initRun() {
  $('#run')?.addEventListener('click', () => void runNow());
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && state.table) {
      e.preventDefault();
      void runNow();
    }
  });
}

/* ----------------------------------------------------------- mobile nav -- */
function initMenu() {
  const btn = $<HTMLButtonElement>('#menu');
  const nav = $('#site-nav');
  if (!btn || !nav) return;
  const setOpen = (open: boolean) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.dataset.open = String(open);
  };
  btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      btn.focus();
    }
  });
  // Returning to a wide viewport must not leave the panel stuck open.
  const wide = window.matchMedia('(min-width: 720px)');
  wide.addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
}

/* ----------------------------------------------------------------- boot -- */
function boot() {
  initTheme();
  initMenu();
  initPicker();
  initDrop();
  initRun();

  const wanted = new URLSearchParams(location.search).get('tpl');
  const id = wanted && (templates as Record<string, FaultTable>)[wanted] ? wanted : 'A';
  // Template A's result is already in the HTML from the build, so selecting it
  // here does not re-run the search. Any other template runs on demand.
  if (id === 'A') {
    state.active = 'A';
    state.table = (templates as Record<string, FaultTable>).A;
    const chosen = $('#chosen');
    const t = state.table;
    if (chosen && t) {
      chosen.innerHTML = `<p class="note"><strong>${escapeHtml(t.name)}</strong> · revision <span class="mono">${escapeHtml(
        t.revision,
      )}</span>. ${escapeHtml(t.summary)}</p><p class="note">Provenance: ${escapeHtml(t.provenance)}</p>`;
    }
    if ($('#result .verdict')) {
      // Reattach handlers to the prerendered toolbar.
      const prerendered = $('#result .result-stack');
      if (prerendered) {
        state.result = runCheck(t!, { maxFaultDepth: 3 });
        wireExports();
      }
    } else {
      void runNow();
    }
  } else {
    selectTemplate(id, true);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
