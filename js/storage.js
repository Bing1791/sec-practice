// 所有 localStorage 操作都集中在這裡。瀏覽器禁止存取時退回記憶體，頁面仍可運作。
const PREFIX = 'ceh.';
const SCHEMA_VERSION = 1;
const memory = new Map();

function rawGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.has(key) ? memory.get(key) : null;
  }
}

function rawSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

export function load(name, fallback) {
  const raw = rawGet(PREFIX + name);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  rawSet(PREFIX + name, JSON.stringify(value));
}

export function remove(name) {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    memory.delete(PREFIX + name);
  }
}

// 記住的密碼刻意不用 PREFIX，才不會被匯出到紀錄檔，也不會被清除或匯入覆蓋
const PASSWORD_KEY = 'ceh-unlock-password';

export function getRememberedPassword() {
  return rawGet(PASSWORD_KEY);
}

export function rememberPassword(password) {
  rawSet(PASSWORD_KEY, password);
}

export function forgetPassword() {
  memory.delete(PASSWORD_KEY);
  try {
    localStorage.removeItem(PASSWORD_KEY);
  } catch {
    // 瀏覽器禁止存取時只有記憶體裡的那份
  }
}

const DEFAULT_SETTINGS = { theme: 'system', passPct: 70, removeAfter: 2, email: '' };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...load('settings', {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  save('settings', next);
  return next;
}

// 錯題庫：{ 題目 id: { wrongCount, streak, lastWrongAt } }
export function getWrong() {
  return load('wrong', {});
}

export function recordWrong(id) {
  const wrong = getWrong();
  const entry = wrong[id] || { wrongCount: 0, streak: 0 };
  wrong[id] = { wrongCount: entry.wrongCount + 1, streak: 0, lastWrongAt: Date.now() };
  save('wrong', wrong);
}

// 回傳 true 表示已連續答對足夠次數，移出錯題庫
export function recordWrongBookCorrect(id) {
  const wrong = getWrong();
  if (!wrong[id]) return false;
  wrong[id].streak += 1;
  const removed = wrong[id].streak >= getSettings().removeAfter;
  if (removed) delete wrong[id];
  save('wrong', wrong);
  return removed;
}

export function removeWrong(id) {
  const wrong = getWrong();
  delete wrong[id];
  save('wrong', wrong);
}

export function getVocab() {
  return load('vocab', []);
}

export function addVocab(word, translation) {
  const vocab = getVocab();
  if (vocab.some((v) => v.word.toLowerCase() === word.toLowerCase())) return false;
  vocab.unshift({ word, translation, addedAt: Date.now() });
  save('vocab', vocab);
  return true;
}

export function removeVocab(word) {
  save('vocab', getVocab().filter((v) => v.word !== word));
}

function allKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key.startsWith(PREFIX)) keys.push(key);
    }
  } catch {
    keys.push(...memory.keys());
  }
  return keys;
}

export function exportAll() {
  const data = {};
  for (const key of allKeys()) {
    data[key.slice(PREFIX.length)] = JSON.parse(rawGet(key));
  }
  return { app: 'ceh-practice', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
}

// 先完整驗證，全部通過才覆蓋，避免壞檔案把現有紀錄清掉
export function importAll(payload) {
  const valid = payload && payload.app === 'ceh-practice' && payload.data && typeof payload.data === 'object'
    && !Array.isArray(payload.data);
  if (!valid) throw new Error('這不是本網站匯出的紀錄檔。');
  if (payload.schemaVersion > SCHEMA_VERSION) throw new Error('紀錄檔的版本比目前網站新，無法匯入。');
  const { data } = payload;
  const objects = { settings: true, wrong: true };
  for (const key of Object.keys(objects)) {
    if (key in data && (typeof data[key] !== 'object' || data[key] === null || Array.isArray(data[key]))) {
      throw new Error(`紀錄檔的 ${key} 格式不正確。`);
    }
  }
  for (const key of ['vocab', 'examHistory']) {
    if (key in data && !Array.isArray(data[key])) throw new Error(`紀錄檔的 ${key} 格式不正確。`);
  }
  clearAll();
  for (const [key, value] of Object.entries(data)) save(key, value);
}

export function clearAll() {
  for (const key of allKeys()) {
    try {
      localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  }
}
