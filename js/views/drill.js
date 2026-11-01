import { getQuestion, practicePool, shuffle } from '../data.js';
import { emptyState, h } from '../dom.js';
import { setKeys } from '../keyboard.js';
import { createQuestion } from '../quiz.js';
import { load, recordWrong, save } from '../storage.js';

function newRound() {
  return { order: shuffle(practicePool()).map((q) => q.id), pos: 0, answered: 0, correct: 0, current: null };
}

export function renderDrill(app) {
  let round = load('drill', null);
  // 題庫更新後，舊題序可能有不存在的 id，直接開新一輪
  if (!round || !round.order.every((id) => getQuestion(id))) round = newRound();
  const persist = () => save('drill', round);
  persist();

  function show() {
    app.replaceChildren(h('h1', {}, '刷題模式'));
    setKeys(null);
    if (round.pos >= round.order.length) {
      const pct = round.answered ? Math.round((round.correct / round.answered) * 100) : 0;
      app.append(emptyState('這一輪做完了', `共 ${round.answered} 題，答對 ${round.correct} 題，正確率 ${pct}%。`,
        h('button', { class: 'btn primary', onclick: () => { round = newRound(); persist(); show(); } }, '重新洗牌，開始下一輪')));
      return;
    }

    const q = getQuestion(round.order[round.pos]);
    const pct = round.answered ? Math.round((round.correct / round.answered) * 100) : 0;
    const meter = h('progress', { max: round.order.length, value: round.pos });
    const status = h('div', { class: 'row between' },
      h('span', {}, `本輪進度 ${round.pos + 1} / ${round.order.length}`),
      h('span', { class: 'rate' }, `正確率 ${pct}%（${round.correct} / ${round.answered}）`));
    const next = () => {
      if (!card.isRevealed()) return;
      round.pos += 1;
      round.current = null;
      persist();
      show();
      window.scrollTo(0, 0);
    };
    const nextBtn = h('button', { class: 'btn primary', onclick: next }, '下一題 →');
    nextBtn.hidden = !round.current;

    const card = createQuestion(q, {
      mode: 'immediate',
      selected: round.current?.selected,
      revealed: Boolean(round.current),
      label: `題目 ${q.id}`,
      onAnswer: (correct, selected) => {
        round.answered += 1;
        if (correct) round.correct += 1;
        else recordWrong(q.id);
        round.current = { selected };
        persist();
        status.querySelector('.rate').textContent = `正確率 ${Math.round((round.correct / round.answered) * 100)}%（${round.correct} / ${round.answered}）`;
        nextBtn.hidden = false;
      },
    });

    app.append(status, meter, card.el, h('div', { class: 'row end nav-row' }, nextBtn));
    setKeys({
      pick: card.pickIndex,
      next,
      enter: () => (card.isRevealed() ? next() : card.submit()),
    });
  }
  show();
}
