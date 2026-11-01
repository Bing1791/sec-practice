// 全站共用的快捷鍵。各頁面用 setKeys 註冊自己需要的動作，換頁時由 app.js 清除。
let handlers = {};

export function setKeys(next) {
  handlers = next || {};
}

const LETTERS = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target.matches?.('input, textarea, select') || target.isContentEditable) return;
  if (document.querySelector('dialog[open]')) return;

  const key = event.key.toLowerCase();
  if (key in LETTERS && handlers.pick) {
    handlers.pick(LETTERS[key]);
    event.preventDefault();
  } else if (key === 'enter' && handlers.enter) {
    // 焦點在按鈕或連結時交給元素本身，否則同一次 Enter 會觸發兩個動作
    if (target.closest?.('button, a, [role="radio"], [role="checkbox"]')) return;
    handlers.enter();
    event.preventDefault();
  } else if (key === 'arrowleft' && handlers.prev) {
    handlers.prev();
    event.preventDefault();
  } else if (key === 'arrowright' && handlers.next) {
    handlers.next();
    event.preventDefault();
  }
});
