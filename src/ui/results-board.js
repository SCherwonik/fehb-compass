// The medical Compare Board inside the results region, plus the "your plan" note. Split out of results.js.
// Board rows = the board's own Cost / Protection / Account / Changes sections (board-model.js) followed by the
// full benefits matrix (matrix-model.js: prescriptions first), so care costs have one source of truth.
import { createBoard } from './board.js';
import { groupPlans } from './grouping.js';
import { MEDICAL_SECTIONS, boardContext, sectionsFor, medicalHeader, scopeText, withEndedColumn } from './board-model.js';
import { endedBaseline } from './model.js';
import { buildMatrix, filterMatrix, matrixBoardSections, pinnedMatrixCells } from './matrix-model.js';
import { createMatrixToolbar, matrixPrefs, setMatrixPrefs, onMatrixPrefs } from './matrix.js';
import { rxSummaryRows } from './rx-model.js';
import { rxBoardSections, rxBoardHooks } from './rx-board.js';
import { anyMatEstimated } from './model.js';
import { openMathDialog } from './math.js';
import { h } from './dom.js';

/** Text for the note under the results header about the user's own plan ('' when there is nothing to say). */
export function mineNoteText(data, state, res, where) {
  const name = data.plans.find((p) => p.year === 2026 && p.code === state.currentPlan2026)?.name ?? 'Your plan';
  if (res.mineStatus === 'ended' && res.ended) return `${name} ended after 2026, so its 2026 numbers are pinned first for comparison. They are not ranked.`;
  if (res.mineStatus === 'ended') return `${name} has no 2027 version and no 2026 rate for this coverage, so it cannot be pinned. Savings are measured against what it cost in 2026.`;
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
    hooks: {
      ...rxBoardHooks,
      // Expected care costs: the figure, its note, and a button that opens how this plan's total adds up
      math(row, td, d) {
        const plan = row.plan?.name ?? row.code ?? 'this plan';
        const btn = h('button', { type: 'button', class: 'bd-math-btn', 'aria-label': `See the math for ${plan}` }, 'See the math');
        btn.addEventListener('click', () => {
          if (!last) return;
          const [data, state, res] = last;
          openMathDialog(row, state, data, { medsInRank: res.medsInRank !== false, matInRank: res.matInRank !== false, matEstimated: anyMatEstimated(res.ranked) }, btn);
        });
        td.replaceChildren(
          h('span', { class: 'bd-v' }, d.text),
          d.best && h('span', { class: 'sr-only' }, ' (best in this row)'),
          d.sub && h('span', { class: 'bd-s' }, d.sub),
          btn);
      },
    },
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
    rerender({ sectionMotion: source === 'expand' });
  });

  function rerender({ sectionMotion = false } = {}) {
    if (last) render(...last, { animate: false, sectionMotion });
  }

  function render(data, state, res, opts = {}, { animate = true, sectionMotion = false } = {}) {
    last = [data, state, res, opts];
    const groups = groupPlans(res.others, state.group);
    if (res.mine) {
      groups.unshift({ key: 'mine', label: 'Your plan', rows: [res.mine], total: 1, note: opts.mineWhere ? `2027 version, not listed for ${opts.mineWhere}` : '2027 version' });
    } else if (res.ended) {
      // no 2027 version: its 2026 numbers as a reference column, pinned like "your plan" but never ranked
      groups.unshift({ key: 'mine', label: 'Your 2026 plan (ended)', rows: [res.ended], total: 1, note: 'Not ranked' });
    }
    const ctx = boardContext(res.ranked, state, res.mine, res.mine ? null : endedBaseline(data, state));
    ctx.filtersOn = res.filtersOn;

    // the full benefits matrix over every plan on the board
    const onBoard = [];
    const seen = new Set();
    for (const g of groups) for (const r of g.rows) if (!r.isEnded && !seen.has(r.code)) { seen.add(r.code); onBoard.push({ code: r.code, benefits: r.benefits }); }
    const rxReady = opts.rx?.factsStatus === 'ready';
    const matrix = buildMatrix(onBoard, {
      year: 2027, enrollment: state.enrollment, status: state.status,
      extra: rxReady ? rxSummaryRows(onBoard.map((p) => p.code)) : [],
    });
    const p = matrixPrefs();
    const f = filterMatrix(matrix, { diffOnly: p.diffOnly, query });
    tools.sync({ hiddenRows: f.hiddenRows, matched: f.matched, query });
    // the ended plan's own 2026 cells for the same matrix rows (rows it lacks show a dash)
    const pinned = res.ended ? pinnedMatrixCells(res.ended.benefits, { enrollment: state.enrollment, status: state.status }) : null;
    const mx = matrixBoardSections(f.sections, { open: p.open, pinned });

    const base = sectionsFor(MEDICAL_SECTIONS, ctx);
    const tail = base.filter((s) => s.key === 'drugs' || s.key === 'network');
    // brochure sections: Drugs (lookup + your medications) replaces the placeholder; What changed follows Changes
    const [rxDrugs, rxChanges] = rxBoardSections({ codes: onBoard.map((p) => p.code), factsStatus: opts.rx?.factsStatus, meds: opts.rx?.meds });
    const head = base.filter((s) => !tail.includes(s));
    const ci = head.findIndex((s) => s.key === 'changes');
    if (rxChanges) head.splice(ci + 1, 0, rxChanges);
    const all = [...head, rxDrugs, ...mx, ...tail.filter((s) => s.key === 'network')];
    const sections = res.ended ? withEndedColumn(all) : all;

    const shown = groups.reduce((n, g) => n + (g.key === 'mine' ? 0 : g.rows.length), 0);
    const segs = groups.filter((g) => g.key !== 'mine').length;
    const n = res.others.length;
    const plans = (k) => `${k} ${k === 1 ? 'plan' : 'plans'}`;
    let text;
    if (state.group === 'all') text = `Showing all ${plans(n)}`;
    else if (state.group === 'top3') text = `Showing ${plans(shown)}: the top ${shown} of ${n} available`;
    else text = `Showing ${plans(shown)}: top 3 in ${segs} ${segs === 1 ? 'group' : 'groups'} of ${n} available`;
    text += res.mine ? ', plus your plan.' : res.ended ? ', plus your 2026 plan for reference (not ranked).' : '.';
    board.update({
      groups,
      sections,
      header: (row, g) => medicalHeader(row, g.rows, ctx, g.key === 'mine' ? '' : scopeText(state.group, g)),
      ctx,
      summary: text,
      enter: !open,
      animate,
      sectionMotion,
    });
    open = true;
  }

  return {
    el: board.el,
    render,
    reset() { open = false; },
  };
}
