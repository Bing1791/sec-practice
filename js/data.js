import { decryptBundle } from './crypto.js';

// 載入題庫，並把 AI 解析、分類併到題目上。
let questions = [];
let byId = new Map();

// 本機有明文題庫就直接使用並回傳 null；否則回傳密文，由 unlockData 解開
export async function loadData() {
  const res = await fetch('data/questions.json');
  if (res.ok) {
    const plain = await res.json();
    // AI 解析是選用的，缺檔時題庫仍可使用
    let ai = {};
    try {
      const aiRes = await fetch('data/explanations_ai.json');
      if (aiRes.ok) ai = await aiRes.json();
    } catch {
      ai = {};
    }
    useData(plain, ai);
    return null;
  }
  const encRes = await fetch('data/questions.enc.json');
  if (!encRes.ok) throw new Error(`questions.enc.json：HTTP ${encRes.status}`);
  return encRes.json();
}

export async function unlockData(payload, password) {
  const bundle = await decryptBundle(payload, password);
  useData(bundle.questions, bundle.ai);
}

function useData(list, ai) {
  questions = list;
  for (const q of questions) {
    const extra = ai[q.id];
    if (!extra) continue;
    q.aiExplanation = extra.explanation;
    if (!q.category) q.category = extra.category;
    if (extra.disputed) {
      q.disputed = true;
      q.disputeReason = extra.disputeReason;
    }
  }
  byId = new Map(questions.map((q) => [q.id, q]));
}

export const allQuestions = () => questions;
export const getQuestion = (id) => byId.get(id);

// 被合併的題目改顯示保留版本（兩版選項順序可能不同，不能只換解析）
export function resolve(q) {
  return q.duplicateOf ? byId.get(q.duplicateOf) : q;
}

export function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 模擬考與刷題的出題範圍：排除重複題，相似題每組只隨機留一題
export function practicePool() {
  const pool = [];
  const groups = new Map();
  for (const q of questions) {
    if (q.duplicateOf) continue;
    if (q.similarGroup) {
      if (!groups.has(q.similarGroup)) groups.set(q.similarGroup, []);
      groups.get(q.similarGroup).push(q);
    } else {
      pool.push(q);
    }
  }
  for (const members of groups.values()) pool.push(members[Math.floor(Math.random() * members.length)]);
  return pool;
}

// 不含重複題、相似題算一組的題數，也就是首頁顯示的題庫數
export function uniqueCount() {
  const groups = new Set();
  let count = 0;
  for (const q of questions) {
    if (q.duplicateOf) continue;
    if (q.similarGroup) groups.add(q.similarGroup);
    else count += 1;
  }
  return count + groups.size;
}

export function isCorrect(q, selected) {
  return selected.length === q.answer.length && q.answer.every((a) => selected.includes(a));
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatDate(ts) {
  return new Date(ts).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short', hour12: false });
}
