/**
 * 排位页数据的内存缓存。
 *
 * 问题：每次点开「排位」都要等 state / 排行榜 / 战绩三个请求回来才显示内容，
 * 其中战绩一次 88KB、后端约 50 条 SQL，网络往返加上渲染能明显感觉到空等。
 * 做法：登录进大厅后后台预取一次，排位页先用缓存立即渲染，再静默刷新（stale-while-revalidate）。
 */
const TTL_MS = 90 * 1000;

const store = { state: null, leaderboard: null, history: null };
const savedAt = { state: 0, leaderboard: 0, history: 0 };

export function readRankedCache(key, ttlMs = TTL_MS) {
  if (!(key in store)) return null;
  const at = savedAt[key] || 0;
  if (!at || Date.now() - at > ttlMs) return null;
  return store[key];
}

export function writeRankedCache(key, value) {
  if (!(key in store)) return;
  store[key] = value;
  savedAt[key] = Date.now();
}

export function clearRankedCache() {
  for (const key of Object.keys(store)) {
    store[key] = null;
    savedAt[key] = 0;
  }
}
