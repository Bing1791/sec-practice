import { emptyState, h } from '../dom.js';
import { getVocab, removeVocab } from '../storage.js';

export function renderVocab(app) {
  function show() {
    app.replaceChildren(h('h1', {}, '生字本'));
    const vocab = getVocab();
    if (!vocab.length) {
      app.append(emptyState('還沒有生字', '在題目、選項或解析中選取文字，再按「加入生字本」。'));
      return;
    }
    app.append(
      h('p', { class: 'muted' }, `共 ${vocab.length} 個`),
      h('ul', { class: 'list' }, vocab.map((item) => h('li', { class: 'card list-item' },
        h('div', { class: 'list-main' },
          h('strong', {}, item.word),
          h('p', { class: 'muted' }, item.translation || '（尚未取得翻譯）')),
        h('button', { class: 'btn small', onclick: () => { removeVocab(item.word); show(); } }, '刪除')))),
    );
  }
  show();
}
