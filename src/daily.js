// daily.js —— 今日挑戰(v5,0907;daily-puzzle-kit「E 場地變體」型)。純函數、node 可直測。
// 全班同一題:日期(台北時區)→ FNV 種子 → 決定性亂數 → 決定賽道/方向/圈數/難度/對手/道具。
// ★ 競速天生沒有「無解日」(溫柔規則人人完賽),所以不需要可解性驗證;但**難度與圈數要夾在課堂尺度內**
//   (最多 3 圈、對手 ≤4、難度不到職業)——不然一堂課跑不完,那才是這型真正的「爛題」。
import { BASE_TRACK_IDS, TRACK_VARIANTS, trackIdOf } from "./track.js";

export const DAILY_LAPS = [1, 2, 3];
export const DAILY_DIFFS = ["kids", "child", "easy", "normal"];   // 刻意不含 hard:課堂用
export const DAILY_AI = [2, 3, 4];

/** 台北時間(UTC+8)的日期字串——「全世界同一題」需要一條固定的換日線。 */
export function dailyKey(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function dailySeed(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

/**
 * 今天的挑戰設定。回傳可直接餵給 game.startRace 的物件 + 給畫面用的 key/label。
 * ★ 刻意固定的三件:單人(教室是各玩各的比時間)、起跑格最後一排(超車才好玩)、輔助 auto(照難度)。
 */
export function dailyChallenge(key = dailyKey()) {
  const rnd = mulberry32(dailySeed(key));
  const base = pick(rnd, BASE_TRACK_IDS);
  const variant = pick(rnd, TRACK_VARIANTS);
  const trackId = trackIdOf(base, variant);
  const laps = pick(rnd, DAILY_LAPS);
  const difficulty = pick(rnd, DAILY_DIFFS);
  const aiCount = pick(rnd, DAILY_AI);
  const items = rnd() < 0.75;            // 四天有三天開道具
  return {
    key, trackId, laps, difficulty, aiCount,
    items, itemDensity: items ? 1 : 0,
    mode: "solo", gridPos: "last", assist: "auto",
  };
}

/** 今天的挑戰紀錄鍵(存本機最佳成績用;每天一格,不跟一般紀錄混)。 */
export const dailyRecordKey = (key) => `daily|${key}`;

/** 網址有沒有要求今日挑戰(?daily 或 ?daily=1;火花深連結用)。 */
export function wantsDaily(search = "") {
  return /[?&]daily(?:=|&|$)/.test(String(search));
}
