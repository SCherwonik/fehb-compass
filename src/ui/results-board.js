// The medical Compare Board inside the results region, plus the "your plan" note. Split out of results.js.
// Board rows = the board's own Cost / Protection / Account / Changes sections (board-model.js) followed by the
// full benefits matrix (matrix-model.js: prescriptions first), so care costs have one source of truth.
import { createBoard } from './board.js';
import { groupPlans } from './grouping.js';
import { MEDICAL_SECTIONS, boardContext, sectionsFor, medicalHeader, scopeText } from './board-model.js';
import { endedBaseline } from './model.js';
import { buildMatrix, filterMatrix, matrixBoardSections } from './matrix-model.js';
import { createMatrixToolbar, matrixPrefs, setMatrixPrefs, onMatrixPrefs } from './matrix.js';

/** Text for the note under the results header about the user's own plan ('' when there is nothing to say). */
export function mineNoteText(data, state, res, where) {
  const name = data.plans.find((p) => p.year === 2026 && p.code === state.currentPlan2026)?.name ?? 'Your plan';
  if (res.mineStatus === 'ended') return `${name} has no 2027 version, so it cannot be pinned. Savings are measured against what it cost in 2026.`;
  if (res.mineStatus === 'uncostable') return `${name} has no 2027 rate for this coverage, so it cannot be pinned.`;
  if (res.mineStatus === 'included' && res.notInState) return `${name} (2027) is not listed for ${where ?? 'nationwide enrollment'}. It is pinned so you can compare.`;
  if (res.mineStatus === 'included' && res.mine) {
    const m = res.mine;
    const view = res.filtersOn ? (m.viewRank ? `, #${m.viewRank} with your filters` : ', outside your filters') : '';
    return `${name} (2027) ranks #${m.globalRank} overall in ${where ?? 'nationwide plans'}${view}. It is pinned first so you can compare.`;
  }
  return '';
}

/**
 * createResultsBoard() -> { el, render(data, state, res, { mineWhere }), reset() }
 * Re-renders itself when the matrix search or prefs change.
 */
export function createResultsBoard() {
  let last = null;
  let query = '';
  let open = false;
  const board = createBoard({
    label: 'Plan comparison board. Columns are plans, best first.',
    onSectionToggle: (key, isOpen) => {
      if (key.startsWith('mx-')) setMatrixPrefs({ open: { [key.slice(3)]: isOpen } }, 'board-section');
    },
  });
  const tools = createMatrixToolbar({
    label: 'Board benefit details',
    onQuery: (q) => { query = q; rerender(); },
  });
  tools.el.classList.add('mx-tools-board');
  board.el.insertBefore(tools.el, board.scroller.parentElement);
  board.el.hidden = true;

  onMatrixPrefs((p, source) => {
    if (source === 'board-section' || board.el.hidden) return;
    rerender();
  });

  function rerender() {
    if (last) render(...last, { animate: false });
  }

  function render(data, state, res, opts = {}, { animate = true } = {}) {
    last = [data, state, res, opts];
    const groups = groupPlans(res.others, state.group);
    if (res.mine) {
      groups.unshift({ key: 'mine', label: 'Your plan', rows: [res.mine], total: 1, note: opts.mineWhere ? `2027 version, not listed for ${opts.mineWhere}` : '2027 version' });
    }
    const ctx = boardContext(res.ranked, state, res.mine, res.mine ? null : endedBaseline(data, state));
    ctx.filtersOn = res.filtersOn;

    // the full benefits matrix over every plan on the board
    const onBoard = [];
    const seen = new Set();
    for (const g of groups) for (const r of g.rows) if (!seen.has(r.code)) { seen.add(r.code); onBoard.push({ code: r.code, benefits: r.benefits }); }
    const matrix = buildMatrix(onBoard, { year: 2027, enrollment: state.enrollment, status: state.status });
    const p = matrixPrefs();
    const f = filterMatrix(matrix, { diffOnly: p.diffOnly, query });
    tools.sync({ hiddenRows: f.hiddenRows, matched: f.matched, query });
    const mx = matrixBoardSections(f.sections, { open: p.open });

    const base = sectionsFor(MEDICAL_SECTIONS, ctx);
    const tail = base.filter((s) => s.key === 'drugs' || s.key === 'network');
    const sections = [...base.filter((s) => !tail.includes(s)), ...tail.filter((s) => s.key === 'drugs'), ...mx, ...tail.filter((s) => s.key === 'network')];

    const shown = groups.reduce((n, g) => n + (g.key === 'mine' ? 0 : g.rows.length), 0);
    const segs = groups.filter((g) => g.key !== 'mine').length;
    const n = res.others.length;
    const plans = (k) => `${k} ${k === 1 ? 'plan' : 'plans'}`;
    let text;
    if (state.group === 'all') text = `Showing all ${plans(n)}`;
    else if (state.group === 'top3') text = `Showing ${plans(shown)}: the top ${shown} of ${n} available`;
    else text = `Showing ${plans(shown)}: top 3 in ${segs} ${segs === 1 ? 'group' : 'groups'} of ${n} available`;
    text += res.mine ? ', plus your plan.' : '.';
    board.update({
      groups,
      sections,
      header: (row, g) => medicalHeader(row, g.rows, ctx, g.key === 'mine' ? '' : scopeText(state.group, g)),
      ctx,
      summary: text,
      enter: !open,
      animate,
    });
    open = true;
  }

  return {
    el: board.el,
    render,
    reset() { open = false; },
  };
}
