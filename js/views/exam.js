import { formatDate, formatDuration, getQuestion, isCorrect, practicePool, shuffle } from '../data.js';
import { confirmDialog, emptyState, h } from '../dom.js';
import { setKeys } from '../keyboard.js';
import { createQuestion } from '../quiz.js';
import { getSettings, load, recordWrong, remove, save } from '../storage.js';

const EXAM_SIZE = 125;
const EXAM_MS = 4 * 60 * 60 * 1000;

const getExam = () => load('exam', null);
const getHistory = () => load('examHistory', []);

function startExam() {
  const pool = shuffle(practicePool()).slice(0, EXAM_SIZE);
  // 只存 startedAt：剩餘時間一律由它計算，重新整理不會重置
  const exam = { id: String(Date.now()), startedAt: Date.now(), durationMs: EXAM_MS, ids: pool.map((q) => q.id), answers: {}, marked: {}, current: 0 };
  save('exam', exam);
  return exam;
}

function submitExam(exam, finishedAt) {
  const { passPct } = getSettings();
  const questions = exam.ids.map(getQuestion).filter(Boolean);
  let correct = 0;
  const categories = {};
  for (const q of questions) {
    const ok = isCorrect(q, exam.answers[q.id] || []);
    const key = q.category || '未分類';
    categories[key] ||= { correct: 0, total: 0 };
    categories[key].total += 1;
    if (ok) {
      correct += 1;
      categories[key].correct += 1;
    } else {
      recordWrong(q.id);
    }
  }
  const pct = questions.length ? Math.round((correct / questions.length) * 1000) / 10 : 0;
  const record = {
    id: exam.id,
    startedAt: exam.startedAt,
    finishedAt,
    usedMs: Math.min(finishedAt - exam.startedAt, exam.durationMs),
    total: questions.length,
    correct,
    pct,
    passPct,
    passed: pct >= passPct,
    ids: exam.ids,
    answers: exam.answers,
    categories,
  };
  save('examHistory', [...getHistory(), record]);
  remove('exam');
  return record;
}

// 重新開啟頁面時若已逾時，以截止時間交卷
export function finalizeIfExpired() {
  const exam = getExam();
  if (!exam) return null;
  const deadline = exam.startedAt + exam.durationMs;
  return Date.now() >= deadline ? submitExam(exam, deadline) : null;
}

export function renderExam(app) {
  const exam = getExam();
  if (exam) return runExam(app, exam);

  const history = getHistory();
  const { passPct } = getSettings();
  app.append(
    h('h1', {}, '模擬考'),
    h('section', { class: 'card' },
      h('ul', { class: 'plain' },
        h('li', {}, `從題庫隨機抽 ${EXAM_SIZE} 題，限時 4 小時`),
        h('li', {}, '作答過程不顯示對錯，可以標記題目稍後檢查'),
        h('li', {}, '重新整理或關閉頁面後可以繼續，計時不會停止'),
        h('li', {}, `及格門檻 ${passPct}%（可在設定調整）`)),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => { startExam(); app.replaceChildren(); runExam(app, getExam()); } }, '開始考試'),
        history.length > 0 && h('a', { class: 'btn', href: '#/exam/history' }, `歷次紀錄（${history.length}）`))),
  );
  return null;
}

function runExam(app, exam) {
  app.classList.add('page-wide');
  const persist = () => save('exam', exam);
  let card = null;
  const clock = h('strong', { class: 'clock', 'aria-label': '剩餘時間' });
  const counter = h('span', {});
  const panelGrid = h('div', { class: 'exam-grid' });
  const panel = h('aside', { class: 'card exam-panel', 'aria-label': '題號導覽' },
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'dot answered' }), '已作答'),
      h('span', {}, h('i', { class: 'dot' }), '未作答'),
      h('span', {}, h('i', { class: 'dot marked' }), '已標記')),
    panelGrid);
  const panelToggle = h('button', { class: 'btn small panel-toggle', 'aria-expanded': 'false', onclick: () => {
    const open = panel.classList.toggle('open');
    panelToggle.setAttribute('aria-expanded', String(open));
  } }, '題號');
  const submitBtn = h('button', { class: 'btn small danger', onclick: () => requestSubmit() }, '交卷');
  const holder = h('div', {});
  const markBtn = h('button', { class: 'btn', onclick: toggleMark });
  const prevBtn = h('button', { class: 'btn', onclick: () => go(exam.current - 1) }, '← 上一題');
  const nextBtn = h('button', { class: 'btn primary', onclick: () => go(exam.current + 1) }, '下一題 →');

  const answeredCount = () => exam.ids.filter((id) => (exam.answers[id] || []).length).length;

  function finish(finishedAt) {
    clearInterval(timer);
    const fresh = getExam();
    if (!fresh) return;
    const record = submitExam(exam, finishedAt);
    location.hash = `#/exam/result/${record.id}`;
  }

  async function requestSubmit() {
    const left = exam.ids.length - answeredCount();
    const message = left
      ? `還有 ${left} 題未作答，未作答視為答錯。確定要交卷嗎？`
      : '已全部作答，確定要交卷嗎？';
    if (await confirmDialog(message, { okText: '交卷', danger: true })) finish(Date.now());
  }

  function toggleMark() {
    const id = exam.ids[exam.current];
    if (exam.marked[id]) delete exam.marked[id];
    else exam.marked[id] = true;
    persist();
    updateChrome();
  }

  function go(index) {
    if (index < 0 || index >= exam.ids.length) return;
    exam.current = index;
    persist();
    panel.classList.remove('open');
    panelToggle.setAttribute('aria-expanded', 'false');
    showQuestion();
    window.scrollTo(0, 0);
  }

  function updateChrome() {
    const id = exam.ids[exam.current];
    counter.textContent = `第 ${exam.current + 1} / ${exam.ids.length} 題｜已答 ${answeredCount()}`;
    markBtn.textContent = exam.marked[id] ? '取消標記' : '標記稍後檢查';
    markBtn.classList.toggle('active', Boolean(exam.marked[id]));
    prevBtn.disabled = exam.current === 0;
    nextBtn.disabled = exam.current === exam.ids.length - 1;
    panelGrid.replaceChildren(...exam.ids.map((qid, i) => {
      const answered = (exam.answers[qid] || []).length > 0;
      const classes = ['num', answered && 'answered', exam.marked[qid] && 'marked', i === exam.current && 'current'].filter(Boolean);
      const state = [answered ? '已作答' : '未作答', exam.marked[qid] && '已標記'].filter(Boolean).join('、');
      return h('button', { class: classes.join(' '), 'aria-label': `第 ${i + 1} 題，${state}`, onclick: () => go(i) }, String(i + 1));
    }));
  }

  function showQuestion() {
    const id = exam.ids[exam.current];
    const q = getQuestion(id);
    card = createQuestion(q, {
      mode: 'exam',
      selected: exam.answers[id] || [],
      label: `第 ${exam.current + 1} 題`,
      onChange: (selected) => {
        exam.answers[id] = selected;
        persist();
        updateChrome();
      },
    });
    holder.replaceChildren(card.el);
    updateChrome();
  }

  function tick() {
    const left = exam.startedAt + exam.durationMs - Date.now();
    if (left <= 0) {
      finish(exam.startedAt + exam.durationMs);
      return;
    }
    clock.textContent = formatDuration(left);
    clock.classList.toggle('warn', left < 5 * 60 * 1000);
  }

  const timer = setInterval(tick, 1000);
  app.append(
    h('div', { class: 'exam-bar' }, clock, counter, h('div', { class: 'row' }, panelToggle, submitBtn)),
    h('div', { class: 'exam-layout' },
      h('div', { class: 'exam-main' }, holder,
        h('div', { class: 'row between nav-row' }, prevBtn, markBtn, nextBtn)),
      panel),
  );
  showQuestion();
  tick();
  setKeys({
    pick: (i) => card.pickIndex(i),
    prev: () => go(exam.current - 1),
    next: () => go(exam.current + 1),
    enter: () => go(exam.current + 1),
  });
  return () => clearInterval(timer);
}

export function renderExamResult(app, id) {
  const record = getHistory().find((r) => r.id === id);
  if (!record) {
    app.append(emptyState('找不到這次考試', '紀錄可能已被清除。', h('a', { class: 'btn', href: '#/exam' }, '回模擬考')));
    return;
  }
  const rows = record.ids.map((qid, index) => ({ q: getQuestion(qid), index })).filter((r) => r.q);
  const statusOf = ({ q }) => {
    const selected = record.answers[q.id] || [];
    if (!selected.length) return 'blank';
    return isCorrect(q, selected) ? 'right' : 'wrong';
  };
  const reviewHolder = h('div', {});
  const filters = [
    ['all', '全部'],
    ['missed', '只看錯題'],
    ['blank', '只看未作答'],
  ];
  const filterBar = h('div', { class: 'segmented', role: 'group', 'aria-label': '篩選檢討題目' }, filters.map(([key, label]) => h('button', {
    class: 'btn small',
    dataset: { filter: key },
    onclick: () => showReview(key),
  }, label)));

  function showReview(filter) {
    filterBar.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
    const shown = rows.filter((r) => {
      const status = statusOf(r);
      if (filter === 'missed') return status !== 'right';
      if (filter === 'blank') return status === 'blank';
      return true;
    });
    reviewHolder.replaceChildren(...(shown.length
      ? shown.map(({ q, index }) => createQuestion(q, { mode: 'review', selected: record.answers[q.id] || [], label: `第 ${index + 1} 題（${q.id}）` }).el)
      : [h('p', { class: 'muted' }, '這個篩選沒有題目。')]));
  }

  const unanswered = rows.filter((r) => statusOf(r) === 'blank').length;
  const categories = Object.entries(record.categories || {})
    .map(([name, v]) => ({ name, ...v, rate: v.total ? v.correct / v.total : 0 }))
    .sort((a, b) => a.rate - b.rate);

  app.append(
    h('h1', {}, '模擬考成績'),
    h('section', { class: 'card result' },
      h('div', { class: `score ${record.passed ? 'good' : 'bad'}` }, `${record.pct}%`),
      h('p', { class: `verdict ${record.passed ? 'good' : 'bad'}` }, record.passed ? `✓ 及格（門檻 ${record.passPct}%）` : `✗ 未及格（門檻 ${record.passPct}%）`),
      h('dl', { class: 'facts' },
        h('dt', {}, '答對題數'), h('dd', {}, `${record.correct} / ${record.total}`),
        h('dt', {}, '未作答'), h('dd', {}, String(unanswered)),
        h('dt', {}, '作答時間'), h('dd', {}, formatDuration(record.usedMs)),
        h('dt', {}, '交卷時間'), h('dd', {}, formatDate(record.finishedAt))),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: '#/exam/history' }, '歷次紀錄'),
        h('a', { class: 'btn', href: '#/wrong' }, '查看錯題庫'))),
    h('section', { class: 'card' },
      h('h2', {}, '各分類答對率'),
      h('p', { class: 'muted small' }, '由低到高排列。'),
      categoryBars(categories)),
    h('h2', {}, '逐題檢討'),
    filterBar,
    reviewHolder,
  );
  showReview('missed');
}

function categoryBars(categories) {
  return h('table', { class: 'bars' },
    h('thead', {}, h('tr', {}, h('th', {}, '分類'), h('th', {}, '答對率'), h('th', { class: 'num-col' }, '題數'))),
    h('tbody', {}, categories.map((c) => {
      const pct = Math.round(c.rate * 100);
      return h('tr', {},
        h('td', {}, c.name),
        h('td', { class: 'bar-cell', title: `${c.name}：${c.correct} / ${c.total} 題，${pct}%` },
          h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${pct}%` })),
          h('span', { class: 'bar-label' }, `${pct}%`)),
        h('td', { class: 'num-col' }, `${c.correct} / ${c.total}`));
    })));
}

export function renderExamHistory(app) {
  const history = getHistory();
  app.append(h('h1', {}, '歷次模擬考'));
  if (!history.length) {
    app.append(emptyState('還沒有紀錄', '完成一次模擬考後，這裡會顯示分數趨勢。', h('a', { class: 'btn primary', href: '#/exam' }, '去模擬考')));
    return;
  }
  app.append(
    h('section', { class: 'card' },
      h('h2', {}, '分數趨勢'),
      trendChart(history)),
    h('section', { class: 'card table-wrap' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, '日期'), h('th', {}, '分數'), h('th', {}, '答對'), h('th', {}, '用時'), h('th', {}, '結果'))),
        h('tbody', {}, [...history].reverse().map((r) => h('tr', {},
          h('td', {}, h('a', { href: `#/exam/result/${r.id}` }, formatDate(r.finishedAt))),
          h('td', {}, `${r.pct}%`),
          h('td', {}, `${r.correct} / ${r.total}`),
          h('td', {}, formatDuration(r.usedMs)),
          h('td', {}, r.passed ? '及格' : '未及格')))))),
  );
}

// 單一數列的折線圖：y 軸固定 0–100%，虛線標示目前的及格門檻，滑過顯示該次分數
function trendChart(history) {
  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const W = 640; const H = 240; const L = 40; const R = 16; const T = 12; const B = 28;
  const x = (i) => (history.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (history.length - 1));
  const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `最近 ${history.length} 次模擬考分數趨勢，最新 ${history[history.length - 1].pct}%` });

  for (const v of [0, 25, 50, 75, 100]) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    const label = svgEl('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' });
    label.textContent = String(v);
    svg.append(label);
  }
  const { passPct } = getSettings();
  svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(passPct), y2: y(passPct), class: 'threshold' }));
  const passLabel = svgEl('text', { x: L + 4, y: y(passPct) - 6, class: 'axis' });
  passLabel.textContent = `及格 ${passPct}%`;
  svg.append(passLabel);

  if (history.length > 1) {
    svg.append(svgEl('polyline', { points: history.map((r, i) => `${x(i)},${y(r.pct)}`).join(' '), class: 'trend' }));
  }
  const tooltip = h('div', { class: 'chart-tip', hidden: true });
  const wrap = h('div', { class: 'chart-wrap' }, svg, tooltip);
  history.forEach((r, i) => {
    const point = svgEl('circle', { cx: x(i), cy: y(r.pct), r: 5, class: 'point' });
    // 命中範圍比標記大，手指也點得到
    const hit = svgEl('circle', { cx: x(i), cy: y(r.pct), r: 18, class: 'hit', tabindex: 0 });
    const show = () => {
      tooltip.textContent = `${formatDate(r.finishedAt)}：${r.pct}%（${r.correct} / ${r.total}）`;
      tooltip.hidden = false;
      tooltip.style.left = `${(x(i) / W) * 100}%`;
      tooltip.style.top = `${(y(r.pct) / H) * 100}%`;
    };
    const hide = () => { tooltip.hidden = true; };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', show);
    hit.addEventListener('blur', hide);
    hit.addEventListener('click', show);
    svg.append(point, hit);
  });
  return wrap;
}
