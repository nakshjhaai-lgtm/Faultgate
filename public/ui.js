// Small interface behaviours that do not belong in the verifier bundle.

const toTop = document.getElementById('to-top');

if (toTop) {
  const toggle = () => {
    toTop.dataset.show = String(window.scrollY > 600);
  };

  toggle();
  window.addEventListener('scroll', toggle, { passive: true });

  toTop.addEventListener('click', () => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
    const main = document.getElementById('main');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
  });
}

// Presentation only: the engine and the importer are untouched. Two situations
// leave the result block reporting something it cannot qualify by itself.
const errorPanel = document.getElementById('error');
const result = document.getElementById('result');
const chosen = document.getElementById('chosen');

if (errorPanel && result) {
  const notes = [
    {
      // A failed run leaves the previous verdict where it was.
      when: () =>
        !errorPanel.classList.contains('hide') && errorPanel.textContent.trim() !== '',
      text:
        'The result below belongs to the table that was on screen before this attempt. ' +
        'It does not describe the run that just failed.',
    },
    {
      // A table with no rule records still imports, and every rule it does not
      // contain passes. The headline reads clear; this says what that is worth.
      when: () => {
        const m = /([0-9]+)[ ]+rules?/.exec(chosen ? chosen.textContent : '');
        return Boolean(m) && m[1] === '0';
      },
      text:
        'This table holds no rule records, so no boundary condition was tested. ' +
        'The verdict below reports that nothing was found to break, not that the table is safe.',
    },
  ];

  const nodes = notes.map((note) => {
    const p = document.createElement('p');
    p.className = 'note result-note';
    p.hidden = true;
    p.textContent = note.text;
    return p;
  });

  const sync = () => {
    notes.forEach((note, i) => {
      const show = note.when();
      const node = nodes[i];
      // The bundle replaces the whole result block on every run, so a node that
      // is no longer in the document has to be put back before it is needed.
      if (show && !node.isConnected) result.prepend(node);
      node.hidden = !show;
    });
  };

  const observer = new MutationObserver(sync);
  observer.observe(errorPanel, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  // The bundle renders the result block at boot and again on every run, which
  // removes these nodes, so watch the block itself as well as the summary line.
  observer.observe(result, { childList: true });
  if (chosen) {
    observer.observe(chosen, { childList: true, characterData: true, subtree: true });
  }

  sync();
}
