import { loadData } from './data.js';
import { h } from './dom.js';
import { setKeys } from './keyboard.js';
import { getSettings } from './storage.js';
import { closeTranslate, initTranslate } from './translate.js';
import { finalizeIfExpired, renderExam, renderExamHistory, renderExamResult } from './views/exam.js';
import { renderDrill } from './views/drill.js';
import { renderHome } from './views/home.js';
import { renderSettings } from './views/settings.js';
import { renderStudy } from './views/study.js';
import { unlock } from './views/unlock.js';
import { renderVocab } from './views/vocab.js';
import { renderWrongBook, renderWrongPractice } from './views/wrongbook.js';

const app = document.getElementById('app');
let cleanup = null;

const routes = [
  [/^\/$/, renderHome, ''],
  [/^\/study$/, renderStudy, 'study'],
  [/^\/drill$/, renderDrill, 'drill'],
  [/^\/exam$/, renderExam, 'exam'],
  [/^\/exam\/history$/, renderExamHistory, 'exam'],
  [/^\/exam\/result\/(.+)$/, renderExamResult, 'exam'],
  [/^\/wrong$/, renderWrongBook, 'wrong'],
  [/^\/wrong\/practice$/, renderWrongPractice, 'wrong'],
  [/^\/vocab$/, renderVocab, 'vocab'],
  [/^\/settings$/, renderSettings, 'settings'],
];

export function applyTheme() {
  const { theme } = getSettings();
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function route() {
  cleanup?.();
  cleanup = null;
  setKeys(null);
  closeTranslate();
  // 離開考試頁後時間到也要交卷
  const expired = finalizeIfExpired();
  if (expired) {
    location.hash = `#/exam/result/${expired.id}`;
    return;
  }

  const path = location.hash.replace(/^#/, '') || '/';
  const match = routes.map(([re, view, nav]) => ({ m: path.match(re), view, nav })).find((r) => r.m);
  app.replaceChildren();
  app.className = 'page';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', Boolean(match) && a.dataset.nav === match.nav);
  });
  if (!match) {
    app.append(h('p', {}, '找不到這個頁面。'), h('a', { class: 'btn', href: '#/' }, '回首頁'));
    return;
  }
  cleanup = match.view(app, ...match.m.slice(1)) || null;
  window.scrollTo(0, 0);
}

async function start() {
  try {
    const locked = await loadData();
    if (locked) await unlock(app, locked);
  } catch (err) {
    app.replaceChildren(
      h('h1', {}, '題庫載入失敗'),
      h('p', {}, `請透過本機伺服器或 GitHub Pages 開啟，不能直接雙擊 index.html。（${err.message}）`),
      h('pre', {}, 'python -m http.server 8000'),
    );
    return;
  }
  initTranslate();
  addEventListener('hashchange', route);
  route();
}

start();
