// 小型 DOM 工具。文字一律走 textContent，題目中的 <、& 不會被當成 HTML。
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

// 用原生 <dialog> 確認；Promise 回傳使用者是否按下確認
export function confirmDialog(message, { okText = '確定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const dialog = h('dialog', { class: 'dialog' },
      h('p', {}, message),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => finish(false) }, cancelText),
        h('button', { class: danger ? 'btn danger' : 'btn primary', 'data-ok': true, onclick: () => finish(true) }, okText)));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function emptyState(title, text, ...actions) {
  return h('div', { class: 'empty' }, h('h2', {}, title), h('p', { class: 'muted' }, text), h('div', { class: 'row center' }, actions));
}
