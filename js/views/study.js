import { allQuestions, resolve } from '../data.js';
import { emptyState, h } from '../dom.js';
import { setKeys } from '../keyboard.js';
import { createQuestion } from '../quiz.js';
import { load, save } from '../storage.js';

const SOURCES = ['ceh13-01.pdf', 'ceh13-02.pdf', 'ceh13-03.pdf', 'ceh13-04.pdf'];

function searchable(q) {
  const shown = resolve(q);
  return `${shown.question} ${Object.values(shown.options).join(' ')}`.toLowerCase();
}

export function renderStudy(app) {
  const state = { source: 'all', query: '', id: null, ...load('study', {}) };
  const persist = () => save('study', state);
  let list = [];
  let index = 0;
  let card = null;

  const sourceSelect = h('select', { 'aria-label': '來源', onchange: (e) => { state.source = e.target.value; state.id = null; refilter(); } },
    h('option', { value: 'all' }, '全部來源'),
    SOURCES.map((s) => h('option', { value: s }, s)));
  sourceSelect.value = state.source;
  const searchInput = h('input', { type: 'search', placeholder: '搜尋題目或選項', 'aria-label': '搜尋', value: state.query });
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = searchInput.value.trim(); state.id = null; refilter(); }, 200);
  });
  const jumpInput = h('input', { type: 'number', min: 1, placeholder: '題號', 'aria-label': '跳到第幾題', inputmode: 'numeric' });
  const jump = () => {
    const n = Number(jumpInput.value);
    if (n >= 1 && n <= list.length) go(n - 1);
    jumpInput.value = '';
    jumpInput.blur();
  };
  jumpInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') jump(); });

  const progress = h('span', { class: 'muted' });
  const holder = h('div', {});
  const revealBtn = h('button', { class: 'btn primary', onclick: toggle }, '顯示答案');
  const prevBtn = h('button', { class: 'btn', onclick: () => go(index - 1) }, '← 上一題');
  const nextBtn = h('button', { class: 'btn', onclick: () => go(index + 1) }, '下一題 →');

  function toggle() {
    if (!card) return;
    if (card.isRevealed()) card.hide();
    else card.reveal();
    revealBtn.textContent = card.isRevealed() ? '隱藏答案' : '顯示答案';
  }

  function refilter() {
    const query = state.query.toLowerCase();
    list = allQuestions().filter((q) => (state.source === 'all' || q.source === state.source)
      && (!query || searchable(q).includes(query)));
    const found = list.findIndex((q) => q.id === state.id);
    index = found >= 0 ? found : 0;
    show();
  }

  function go(next) {
    if (next < 0 || next >= list.length) return;
    index = next;
    show();
    window.scrollTo(0, 0);
  }

  function show() {
    holder.replaceChildren();
    const q = list[index];
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= list.length - 1;
    revealBtn.hidden = !q;
    if (!q) {
      card = null;
      progress.textContent = '0 題';
      holder.append(emptyState('沒有符合的題目', '換個關鍵字或來源試試。'));
      return;
    }
    state.id = q.id;
    persist();
    progress.textContent = `第 ${index + 1} / ${list.length} 題`;
    const shown = resolve(q);
    card = createQuestion(shown, { mode: 'study', label: `題目 ${q.id}` });
    if (shown !== q) {
      holder.append(h('p', { class: 'muted small' }, `此題與 ${shown.id} 重複，顯示保留版本；${shown.id} 有解析時也一併顯示。`));
    }
    holder.append(card.el);
    revealBtn.textContent = '顯示答案';
  }

  app.append(
    h('h1', {}, '學習模式'),
    h('div', { class: 'toolbar' }, sourceSelect, searchInput, jumpInput),
    h('div', { class: 'row between' }, progress, revealBtn),
    holder,
    h('div', { class: 'row between nav-row' }, prevBtn, nextBtn),
  );
  refilter();
  setKeys({ prev: () => go(index - 1), next: () => go(index + 1), enter: toggle });
}
