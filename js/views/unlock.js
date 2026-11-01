import { cryptoAvailable, WrongPasswordError } from '../crypto.js';
import { unlockData } from '../data.js';
import { h } from '../dom.js';
import { forgetPassword, getRememberedPassword, rememberPassword } from '../storage.js';

// 題庫解開後 resolve；解鎖前隱藏導覽，因為其他頁面都需要題庫
export async function unlock(app, payload) {
  const nav = document.querySelector('.topnav');
  nav.hidden = true;
  if (!cryptoAvailable()) {
    app.replaceChildren(
      h('h1', {}, '無法解鎖題庫'),
      h('p', {}, '這個網址沒有提供 Web Crypto，請改用 HTTPS 網址或 localhost 開啟。'),
    );
    return new Promise(() => {});
  }

  let notice = '';
  const remembered = getRememberedPassword();
  if (remembered) {
    app.replaceChildren(h('p', { class: 'muted' }, '解鎖題庫中…'));
    try {
      await unlockData(payload, remembered);
      nav.hidden = false;
      return undefined;
    } catch (err) {
      if (!(err instanceof WrongPasswordError)) throw err;
      forgetPassword();
      notice = '記住的密碼已失效，請重新輸入。';
    }
  }

  return new Promise((resolve, reject) => {
    const input = h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' });
    const remember = h('input', { type: 'checkbox', name: 'remember' });
    const button = h('button', { class: 'btn primary', type: 'submit' }, '解鎖');
    const message = h('p', { class: 'status unlock-error', role: 'alert' }, notice);

    const form = h('form', {
      class: 'card form',
      onsubmit: async (event) => {
        event.preventDefault();
        button.disabled = true;
        button.textContent = '解鎖中…';
        message.textContent = '';
        try {
          await unlockData(payload, input.value);
        } catch (err) {
          button.disabled = false;
          button.textContent = '解鎖';
          if (!(err instanceof WrongPasswordError)) {
            reject(err);
            return;
          }
          message.textContent = '密碼錯誤，請再試一次。';
          input.select();
          return;
        }
        if (remember.checked) rememberPassword(input.value);
        nav.hidden = false;
        resolve();
      },
    },
    h('label', {}, '題庫密碼', input),
    h('label', { class: 'choice' }, remember, '在這台裝置記住密碼'),
    h('p', { class: 'muted small' }, '密碼會以明文存在這個瀏覽器，請只在自己的裝置上勾選。可到設定頁清除。'),
    message,
    h('div', { class: 'row' }, button));

    app.replaceChildren(h('h1', {}, '解鎖題庫'), form);
    input.focus();
  });
}
