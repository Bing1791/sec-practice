import { applyTheme } from '../app.js';
import { confirmDialog, h } from '../dom.js';
import { clearAll, exportAll, forgetPassword, getRememberedPassword, getSettings, importAll, saveSettings } from '../storage.js';

export function renderSettings(app, message = '') {
  const settings = getSettings();
  const status = h('p', { class: 'status', role: 'status' }, message);
  const say = (text) => { status.textContent = text; };

  const themeOption = (value, label) => h('label', { class: 'choice' },
    h('input', { type: 'radio', name: 'theme', value, checked: settings.theme === value,
      onchange: () => { saveSettings({ theme: value }); applyTheme(); } }),
    label);

  const clampNumber = (input, min, max, key) => {
    input.addEventListener('change', () => {
      const n = Math.min(max, Math.max(min, Math.round(Number(input.value)) || getSettings()[key]));
      input.value = n;
      saveSettings({ [key]: n });
      say('已儲存。');
    });
    return input;
  };

  const emailInput = h('input', { type: 'email', value: settings.email, placeholder: 'you@example.com', autocomplete: 'email' });
  emailInput.addEventListener('change', () => {
    saveSettings({ email: emailInput.value.trim() });
    say('已儲存。');
  });

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!await confirmDialog('匯入會覆蓋這台裝置上目前的所有紀錄，確定要繼續嗎？', { okText: '匯入' })) return;
      importAll(payload);
      applyTheme();
      renderAgain('匯入完成。');
    } catch (err) {
      say(`匯入失敗：${err instanceof SyntaxError ? '檔案不是有效的 JSON。' : err.message}`);
    }
  });

  function renderAgain(text) {
    app.replaceChildren();
    renderSettings(app, text);
  }

  function exportFile() {
    const blob = new Blob([JSON.stringify(exportAll(), null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `ceh-practice-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    say('已匯出。');
  }

  async function clearRecords() {
    if (!await confirmDialog('確定要清除所有紀錄嗎？包含錯題庫、作答紀錄、模擬考和生字本。', { okText: '繼續', danger: true })) return;
    if (!await confirmDialog('最後確認：清除後無法復原。', { okText: '清除所有紀錄', danger: true })) return;
    clearAll();
    applyTheme();
    renderAgain('已清除所有紀錄。');
  }

  app.append(
    h('h1', {}, '設定'),
    h('section', { class: 'card form' },
      h('h2', {}, '主題'),
      h('div', { class: 'row' }, themeOption('system', '跟隨系統'), themeOption('light', '淺色'), themeOption('dark', '深色'))),
    h('section', { class: 'card form' },
      h('h2', {}, '練習'),
      h('label', {}, '模擬考及格門檻（%）',
        clampNumber(h('input', { type: 'number', min: 1, max: 100, value: settings.passPct, name: 'passPct' }), 1, 100, 'passPct')),
      h('label', {}, '連續答對幾次後移出錯題庫',
        clampNumber(h('input', { type: 'number', min: 1, max: 20, value: settings.removeAfter, name: 'removeAfter' }), 1, 20, 'removeAfter'))),
    h('section', { class: 'card form' },
      h('h2', {}, '翻譯'),
      h('label', {}, 'MyMemory email（選填，可提高每日額度）', emailInput),
      h('p', { class: 'muted small' }, '有填寫時，email 會隨翻譯請求傳給 MyMemory。選取的文字也會傳給 MyMemory 進行翻譯。')),
    h('section', { class: 'card form' },
      h('h2', {}, '資料'),
      h('p', { class: 'muted small' }, '紀錄只存在這個瀏覽器。用匯出 / 匯入在電腦和手機之間轉移。'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: exportFile }, '匯出作答紀錄'),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, '匯入作答紀錄'),
        fileInput),
      h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: clearRecords }, '清除所有紀錄'))),
    h('section', { class: 'card form' },
      h('h2', {}, '題庫密碼'),
      h('p', { class: 'muted small' }, getRememberedPassword() ? '這台裝置已記住密碼。' : '這台裝置沒有記住密碼。'),
      h('div', { class: 'row' }, h('button', {
        class: 'btn',
        disabled: !getRememberedPassword(),
        onclick: () => { forgetPassword(); renderAgain('已清除記住的密碼。'); },
      }, '清除記住的密碼'))),
    status,
    h('section', { class: 'card form' },
      h('h2', {}, '鍵盤快捷鍵'),
      h('p', { class: 'muted small' }, 'A–D 或 1–4 選答案；Enter 送出或下一題；← → 換題。')),
  );
}
