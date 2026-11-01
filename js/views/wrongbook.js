import { getQuestion, shuffle } from '../data.js';
import { confirmDialog, emptyState, h } from '../dom.js';
import { setKeys } from '../keyboard.js';
import { createQuestion } from '../quiz.js';
import { getSettings, getWrong, load, recordWrong, recordWrongBookCorrect, removeWrong, save } from '../storage.js';

const noWrongState = () => emptyState('錯題庫是空的', '先做一次模擬考或刷題，答錯的題目會自動收進來。',
  h('a', { class: 'btn primary', href: '#/exam' }, '去模擬考'),
  h('a', { class: 'btn', href: '#/drill' }, '去刷題'));

const validEntries = () => Object.entries(getWrong()).filter(([id]) => getQuestion(id));

export function renderWrongBook(app) {
  let sortBy = load('wrongSort', 'count');

  function show() {
    app.replaceChildren(h('h1', {}, '錯題庫'));
    const entries = validEntries();
    if (!entries.length) {
      app.append(noWrongState());
      return;
    }
    entries.sort(sortBy === 'count'
      ? (a, b) => b[1].wrongCount - a[1].wrongCount || b[1].lastWrongAt - a[1].lastWrongAt
      : (a, b) => b[1].lastWrongAt - a[1].lastWrongAt);
    const { removeAfter } = getSettings();
    const sortSelect = h('select', { 'aria-label': '排序', onchange: (e) => { sortBy = e.target.value; save('wrongSort', sortBy); show(); } },
      h('option', { value: 'count' }, '依答錯次數排序'),
      h('option', { value: 'recent' }, '依最近答錯排序'));
    sortSelect.value = sortBy;

    app.append(
      h('div', { class: 'row between' },
        h('span', { class: 'muted' }, `共 ${entries.length} 題；連續答對 ${removeAfter} 次自動移出`),
        h('a', { class: 'btn primary', href: '#/wrong/practice' }, '開始練習')),
      h('div', { class: 'toolbar' }, sortSelect),
      h('ul', { class: 'list' }, entries.map(([id, entry]) => {
        const q = getQuestion(id);
        return h('li', { class: 'card list-item' },
          h('div', { class: 'list-main' },
            h('div', { class: 'muted small' }, `${id}｜答錯 ${entry.wrongCount} 次｜連續答對 ${entry.streak} 次`),
            h('p', { class: 'clamp translatable' }, q.question)),
          h('button', { class: 'btn small', onclick: async () => {
            if (await confirmDialog(`把 ${id} 移出錯題庫？`)) {
              removeWrong(id);
              show();
            }
          } }, '移除'));
      })),
    );
  }
  show();
}

export function renderWrongPractice(app) {
  let queue = load('wrongQueue', []).filter((id) => getWrong()[id] && getQuestion(id));

  function show() {
    app.replaceChildren(h('h1', {}, '錯題練習'));
    setKeys(null);
    const entries = validEntries();
    if (!entries.length) {
      save('wrongQueue', []);
      app.append(noWrongState());
      return;
    }
    if (!queue.length) queue = shuffle(entries.map(([id]) => id));
    save('wrongQueue', queue);

    const id = queue[0];
    const q = getQuestion(id);
    const entry = getWrong()[id];
    const { removeAfter } = getSettings();
    const status = h('p', { class: 'muted' }, `錯題庫剩 ${entries.length} 題｜本題答錯 ${entry.wrongCount} 次，連續答對 ${entry.streak} / ${removeAfter} 次`);
    const next = () => {
      if (!card.isRevealed()) return;
      show();
      window.scrollTo(0, 0);
    };
    const nextBtn = h('button', { class: 'btn primary', onclick: next }, '下一題 →');
    nextBtn.hidden = true;

    const card = createQuestion(q, {
      mode: 'immediate',
      label: `題目 ${id}`,
      onAnswer: (correct) => {
        // 這題已作答，重新整理時不會再出同一題
        queue.shift();
        save('wrongQueue', queue);
        if (correct) {
          const removed = recordWrongBookCorrect(id);
          const updated = getWrong()[id];
          status.textContent = removed
            ? `答對了，已連續答對 ${removeAfter} 次，移出錯題庫。`
            : `答對了，連續答對 ${updated.streak} / ${removeAfter} 次。`;
        } else {
          recordWrong(id);
          status.textContent = `答錯了，連續答對次數歸零（累計答錯 ${getWrong()[id].wrongCount} 次）。`;
        }
        nextBtn.hidden = false;
      },
    });

    app.append(status, card.el, h('div', { class: 'row between nav-row' },
      h('a', { class: 'btn', href: '#/wrong' }, '回錯題庫'),
      nextBtn));
    setKeys({
      pick: card.pickIndex,
      next,
      enter: () => (card.isRevealed() ? next() : card.submit()),
    });
  }
  show();
}
