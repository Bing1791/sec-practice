// 共用題目元件。mode：
//   immediate 立即判定（刷題、錯題）   exam 作答不判定
//   study 由「顯示答案」揭曉           review 直接顯示結果（檢討）
import { h } from './dom.js';
import { isCorrect } from './data.js';

const answerText = (q, letters) => letters.map((k) => `${k}. ${q.options[k] ?? ''}`).join('；');

function paragraphs(text) {
  return text.split('\n').filter(Boolean).map((line) => h('p', {}, line));
}

export function explanationBlock(q) {
  const parts = [];
  if (q.corrected) {
    parts.push(h('div', { class: 'notice corrected' },
      h('span', { class: 'badge corrected' }, '答案已修正'),
      h('p', {}, h('strong', {}, 'PDF 原答案：'), answerText(q, q.pdfAnswer)),
      h('p', {}, h('strong', {}, '修正理由：'), q.correctionReason)));
  }
  if (q.disputed) {
    parts.push(h('div', { class: 'notice disputed' },
      h('span', { class: 'badge disputed' }, '答案疑義'),
      h('p', {}, q.disputeReason)));
  }
  if (q.answerSource === 'ai') parts.push(h('p', {}, h('span', { class: 'badge ai' }, 'AI 推定答案')));
  if (q.explanation) {
    parts.push(h('div', { class: 'explain translatable' },
      h('h3', {}, q.corrected ? 'PDF 原解析（依原答案撰寫，僅供參考）' : '解析'),
      paragraphs(q.explanation)));
  }
  if (q.aiExplanation) {
    parts.push(h('div', { class: 'explain translatable' },
      h('h3', {}, h('span', { class: 'badge ai' }, 'AI 補充解析')),
      paragraphs(q.aiExplanation)));
  }
  return parts;
}

export function createQuestion(q, { mode, selected = [], revealed = false, onAnswer, onChange, label } = {}) {
  const state = { selected: new Set(selected), revealed: revealed || mode === 'review' };
  const letters = Object.keys(q.options);
  const optionEls = new Map();
  const submitBtn = q.multi && mode === 'immediate'
    ? h('button', { class: 'btn primary', onclick: () => api.submit() }, '送出')
    : null;
  const feedback = h('div', { class: 'feedback' });

  const canPick = () => (mode === 'immediate' || mode === 'exam') && !state.revealed;

  function pick(letter) {
    if (!canPick() || !q.options[letter]) return;
    if (q.multi) {
      if (state.selected.has(letter)) state.selected.delete(letter);
      else state.selected.add(letter);
    } else if (mode === 'exam' && state.selected.has(letter)) {
      state.selected.clear();
    } else {
      state.selected = new Set([letter]);
    }
    if (mode === 'immediate' && !q.multi) {
      api.submit();
      return;
    }
    update();
    onChange?.([...state.selected]);
  }

  // 選項用 div 而不是 button：按鈕內的文字在部分瀏覽器無法選取，選字翻譯會失效
  const list = h('div', { class: 'options', role: q.multi ? 'group' : 'radiogroup' }, letters.map((letter) => {
    const el = h('div', {
      class: 'option',
      role: q.multi ? 'checkbox' : 'radio',
      tabindex: canPick() ? 0 : -1,
      onclick: () => {
        // 拖曳選字時不算作答
        if (String(window.getSelection())) return;
        pick(letter);
      },
      onkeydown: (event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          pick(letter);
        }
      },
    },
    h('span', { class: 'option-key' }, letter),
    h('span', { class: 'option-text translatable' }, q.options[letter]));
    optionEls.set(letter, el);
    return el;
  }));

  function update() {
    for (const [letter, el] of optionEls) {
      const chosen = state.selected.has(letter);
      el.classList.toggle('selected', chosen);
      el.setAttribute('aria-checked', String(chosen));
      el.classList.toggle('locked', !canPick());
      el.tabIndex = canPick() ? 0 : -1;
      const showResult = state.revealed;
      el.classList.toggle('correct', showResult && q.answer.includes(letter));
      el.classList.toggle('wrong', showResult && chosen && !q.answer.includes(letter));
    }
    if (submitBtn) submitBtn.hidden = state.revealed;
    feedback.replaceChildren();
    if (state.revealed) {
      const items = [];
      if (mode === 'immediate' || mode === 'review') {
        const ok = isCorrect(q, [...state.selected]);
        const unanswered = state.selected.size === 0;
        items.push(h('p', { class: `verdict ${ok ? 'good' : 'bad'}` },
          ok ? '✓ 答對了' : (unanswered ? '✗ 未作答' : '✗ 答錯了')));
      }
      if (mode === 'review') {
        items.push(h('p', {}, h('strong', {}, '我的答案：'), state.selected.size ? answerText(q, [...state.selected].sort()) : '未作答'));
      }
      items.push(h('p', {}, h('strong', {}, '正確答案：'), answerText(q, q.answer)));
      items.push(...explanationBlock(q));
      feedback.append(...items);
    }
  }

  const api = {
    el: h('article', { class: 'card question' },
      h('div', { class: 'question-meta' },
        h('span', {}, label || `題目 ${q.id}`),
        q.multi && h('span', { class: 'badge multi' }, `複選（${q.answer.length} 個答案）`)),
      h('p', { class: 'stem translatable' }, q.question),
      list,
      submitBtn,
      feedback),
    pickIndex: (index) => pick(letters[index]),
    submit() {
      if (state.revealed || state.selected.size === 0) return;
      state.revealed = true;
      update();
      onAnswer?.(isCorrect(q, [...state.selected]), [...state.selected]);
    },
    reveal() {
      state.revealed = true;
      update();
    },
    hide() {
      state.revealed = false;
      update();
    },
    isRevealed: () => state.revealed,
    hasSelection: () => state.selected.size > 0,
  };
  update();
  return api;
}
