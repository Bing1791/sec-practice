// 選字翻譯：在 .translatable 區塊選取文字後跳出小視窗。
import { h } from './dom.js';
import { addVocab, getSettings, load, save } from './storage.js';

const MAX_BYTES = 500;
const CACHE_LIMIT = 2000;
const API = 'https://api.mymemory.translated.net/get';

const googleUrl = (text) => `https://translate.google.com/?sl=en&tl=zh-TW&op=translate&text=${encodeURIComponent(text)}`;

class QuotaError extends Error {}

async function translate(text) {
  const cache = load('translations', {});
  if (cache[text]) return cache[text];

  const url = new URL(API);
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', 'en|zh-TW');
  const { email } = getSettings();
  if (email) url.searchParams.set('de', email);

  const res = await fetch(url);
  if (res.status === 429) throw new QuotaError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const translated = body.responseData?.translatedText || '';
  if (body.quotaFinished || Number(body.responseStatus) === 429 || /YOU USED ALL AVAILABLE FREE TRANSLATIONS/i.test(translated)) {
    throw new QuotaError();
  }
  if (Number(body.responseStatus) !== 200 || !translated) throw new Error('翻譯服務沒有回傳結果');

  const keys = Object.keys(cache);
  if (keys.length >= CACHE_LIMIT) delete cache[keys[0]];
  cache[text] = translated;
  save('translations', cache);
  return translated;
}

let popup = null;
let pinned = false;
let current = '';

function closePopup() {
  popup?.remove();
  popup = null;
  pinned = false;
  current = '';
}

function position(el, rect) {
  // 手機上系統的選取選單會蓋住選字附近，固定在畫面底部
  if (matchMedia('(pointer: coarse)').matches || innerWidth < 600) {
    el.classList.add('docked');
    return;
  }
  const box = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.left), innerWidth - box.width - 8);
  const below = rect.bottom + 8;
  const top = below + box.height > innerHeight - 8 ? Math.max(8, rect.top - box.height - 8) : below;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function showPopup(text, rect) {
  closePopup();
  current = text;
  const result = h('p', { class: 'translate-result', 'aria-live': 'polite' }, '翻譯中…');
  const message = h('p', { class: 'translate-message' });
  message.hidden = true;
  const google = h('a', { href: googleUrl(text), target: '_blank', rel: 'noopener', class: 'translate-google' }, '用 Google 翻譯開啟');
  const addBtn = h('button', { class: 'btn small', disabled: true }, '加入生字本');
  let translated = '';
  addBtn.addEventListener('click', () => {
    const added = addVocab(text, translated);
    addBtn.textContent = added ? '已加入' : '已在生字本中';
    addBtn.disabled = true;
  });

  popup = h('div', { class: 'translate-popup', role: 'dialog', 'aria-label': '翻譯' },
    h('div', { class: 'translate-head' },
      h('span', { class: 'translate-source' }, text),
      h('button', { class: 'icon-btn', 'aria-label': '關閉', onclick: closePopup }, '×')),
    result,
    message,
    h('div', { class: 'row between' }, google, addBtn));
  // 按小視窗不要清掉選取
  popup.addEventListener('pointerdown', () => { pinned = true; });
  popup.addEventListener('mousedown', (event) => {
    if (!event.target.closest('a')) event.preventDefault();
  });
  document.body.append(popup);
  position(popup, rect);

  const fail = (notice) => {
    if (current !== text) return;
    result.textContent = '無法取得翻譯';
    message.textContent = notice;
    message.hidden = false;
    // 仍可把原文存進生字本，之後再查
    addBtn.disabled = false;
  };

  if (new TextEncoder().encode(text).length > MAX_BYTES) {
    fail('選取的文字太長（上限 500 bytes），請用 Google 翻譯。');
    return;
  }
  translate(text).then((value) => {
    if (current !== text) return;
    translated = value;
    result.textContent = value;
    addBtn.disabled = false;
    position(popup, rect);
  }).catch((err) => {
    fail(err instanceof QuotaError
      ? '今日免費翻譯額度已用完。可到設定頁填寫 email 提高額度，或先用 Google 翻譯。'
      : '翻譯服務暫時無法使用，請用 Google 翻譯。');
  });
}

function handleSelection() {
  const selection = window.getSelection();
  const text = String(selection).replace(/\s+/g, ' ').trim();
  if (!text || !selection.rangeCount) {
    if (popup && !pinned) closePopup();
    return;
  }
  const node = selection.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!element?.closest('.translatable') || text === current) return;
  pinned = false;
  showPopup(text, selection.getRangeAt(0).getBoundingClientRect());
}

export function initTranslate() {
  let timer = null;
  const schedule = (delay) => {
    clearTimeout(timer);
    timer = setTimeout(handleSelection, delay);
  };
  document.addEventListener('mouseup', () => schedule(10));
  document.addEventListener('keyup', (event) => {
    if (event.shiftKey || event.key === 'Shift') schedule(150);
  });
  // 手機長按選取只有 selectionchange 會觸發；等拖曳調整範圍告一段落再翻譯
  document.addEventListener('selectionchange', () => schedule(600));
  document.addEventListener('pointerdown', (event) => {
    if (popup && !popup.contains(event.target)) {
      pinned = false;
    }
  });
}

export function closeTranslate() {
  closePopup();
}
