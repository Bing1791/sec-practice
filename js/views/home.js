import { allQuestions, formatDuration, uniqueCount } from '../data.js';
import { h } from '../dom.js';
import { getWrong, load } from '../storage.js';

const MODES = [
  ['#/study', '學習模式', '瀏覽、搜尋題目，自己決定何時看答案'],
  ['#/drill', '刷題模式', '全部題目隨機出題，立刻顯示對錯'],
  ['#/exam', '模擬考', '依 CEH 規格：125 題、4 小時'],
  ['#/wrong', '錯題練習', '反覆練習答錯的題目，直到真的會'],
];

export function renderHome(app) {
  const wrongCount = Object.keys(getWrong()).length;
  const history = load('examHistory', []);
  const last = history[history.length - 1];
  const activeExam = load('exam', null);

  app.append(
    activeExam ? h('a', { class: 'banner', href: '#/exam' },
      h('strong', {}, '有進行中的模擬考'),
      h('span', {}, `剩餘 ${formatDuration(activeExam.startedAt + activeExam.durationMs - Date.now())}，點此繼續`)) : '',
    h('section', { class: 'stats', 'aria-label': '統計' },
      stat('題庫總數', uniqueCount(), `已去重，原始 ${allQuestions().length} 題`),
      stat('錯題數', wrongCount, '目前在錯題庫中'),
      stat('最近模擬考', last ? `${last.pct}%` : '—', last ? `${last.correct} / ${last.total} 題，${last.passed ? '及格' : '未及格'}` : '尚未考過')),
    h('section', { class: 'modes' }, MODES.map(([href, title, text]) => h('a', { class: 'card mode', href },
      h('h2', {}, title),
      h('p', { class: 'muted' }, text)))),
  );
}

function stat(label, value, note) {
  return h('div', { class: 'card stat' },
    h('div', { class: 'muted small' }, label),
    h('div', { class: 'stat-value' }, String(value)),
    h('div', { class: 'muted small' }, note));
}
