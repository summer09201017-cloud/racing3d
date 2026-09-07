// items.js —— 賽道道具層(v5,0907)。純函數、零依賴 THREE、node 可直測。
// ★ 不手工擺點:道具由賽道幾何 + trackId 決定性種子**自動生成** ⇒ 12 條變體(含逆走/鏡像)全自動有道具,
//   加新賽道也不用補資料。位置有遊戲意義:加速板在直線、油漬在彎道內側(貪內線的代價)、星星在彎道外側(繞遠去撿)。
// ★ 每圈重生:每台車各自記「這一圈撿過哪些」,跨線清空 ⇒ 多人各撿各的、不互搶(教室情境不吵架)。
// ★ 溫柔規則:油漬只讓抓地變差(會滑、要修正),不旋轉、不失控、不停車。
import { posAt, pointAtOffset, wrapDist } from "./track.js";

export const ITEM_TYPES = {
  boost: { id: "boost", label: "加速板", emoji: "⚡", radius: 2.2, color: 0x2ecc71, boostSeconds: 1.1 },
  oil:   { id: "oil",   label: "油漬",   emoji: "🛢️", radius: 1.9, color: 0x2b2b33, slipSeconds: 1.8, gripMul: 0.45 },
  star:  { id: "star",  label: "星星",   emoji: "⭐", radius: 2.4, color: 0xffd24a, turboRefill: 0.45 },
};
export const ITEM_IDS = Object.keys(ITEM_TYPES);

/* 生成參數(量值可調):曲率門檻與間距都以「公尺」與「1/m」為單位。 */
export const ITEM_GEN = {
  minGap: 55,          // 同類道具最短間隔(公尺)
  straightK: 0.004,    // 曲率絕對值低於這個算直線
  cornerK: 0.010,      // 高於這個算彎道
  boostLat: 0,         // 加速板在中線
  oilLat: 0.42,        // 油漬在半寬的四成二處(內線)
  starLat: 0.66,       // 星星在半寬的六成六處(外線)
  edgeGap: 40,         // 起跑線前後這段不放(不然一開賽就吃到)
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* trackId → 種子(FNV-1a):同一條賽道每次都一樣,不同賽道/不同方向各自不同。 */
export function trackSeed(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * 依賽道幾何生成道具。回傳 [{ id, type, dist, lateral, x, y, z }](id 在同一條賽道內唯一且穩定)。
 * density 0..1(0=不放;1=標準密度),來自選單「道具」開關。
 */
export function buildItems(track, density = 1) {
  const out = [];
  if (!(density > 0)) return out;
  const S = track.samples, N = track.N, L = track.length;
  const rnd = mulberry32(trackSeed(track.id));
  const halfW = track.halfW;
  const lastAt = { boost: -1e9, oil: -1e9, star: -1e9 };
  const gap = ITEM_GEN.minGap / Math.max(0.35, density);   // 密度低 = 間隔拉大
  const step = Math.max(1, Math.round(N / Math.max(60, L / 8)));   // 每 ~8m 看一個取樣點
  for (let i = 0; i < N; i += step) {
    const s = S[i], d = s.dist, k = Math.abs(s.k);
    if (d < ITEM_GEN.edgeGap || d > L - ITEM_GEN.edgeGap) continue;   // 起跑線前後留白
    let type = null, lat = 0;
    if (k < ITEM_GEN.straightK) {
      type = "boost"; lat = ITEM_GEN.boostLat;
    } else if (k > ITEM_GEN.cornerK) {
      // 彎內側 = 曲率符號那一側(k>0 右彎 ⇒ 內側在右 = +);外側相反
      const inSide = s.k > 0 ? 1 : -1;
      if (rnd() < 0.55) { type = "oil"; lat = ITEM_GEN.oilLat * inSide; }
      else { type = "star"; lat = ITEM_GEN.starLat * -inSide; }
    }
    if (!type) continue;
    if (d - lastAt[type] < gap) continue;
    lastAt[type] = d;
    const p = pointAtOffset(track, d, lat * halfW);
    out.push({ id: `${type}-${out.length}`, type, dist: d, lateral: lat * halfW, x: p.x, y: p.y, z: p.z });
  }
  return out;
}

/** 這台車這一幀有沒有壓到道具。純函數:不改 items,只改 car 的效果欄位,回傳事件陣列。 */
export function stepItems(car, items, prevDist, track) {
  const hits = [];
  if (!items || !items.length || car.finished) return hits;
  if (!car.pickedIds) car.pickedIds = new Set();
  const L = track.length;
  // 這一幀走過的里程區間(可能跨過起跑線)
  let from = prevDist, to = car.trackDist;
  let span = to - from;
  if (span > L / 2) span -= L; else if (span < -L / 2) span += L;
  if (span <= 0) return hits;             // 停著或倒退不吃道具
  for (const it of items) {
    if (car.pickedIds.has(it.id)) continue;
    // 道具里程是否落在 [from, from+span] 這段(繞圈用 wrap 差)
    let rel = it.dist - from;
    if (rel > L / 2) rel -= L; else if (rel < -L / 2) rel += L;
    const cfg = ITEM_TYPES[it.type];
    if (rel < -cfg.radius || rel > span + cfg.radius) continue;
    if (Math.abs(car.lateral - it.lateral) > cfg.radius + 0.9) continue;   // 橫向沒對上
    car.pickedIds.add(it.id);
    applyItem(car, it.type);
    hits.push({ type: it.type, item: it });
  }
  return hits;
}

/** 套用道具效果(純狀態改動,不碰物理常數)。 */
export function applyItem(car, type) {
  const cfg = ITEM_TYPES[type];
  if (!cfg) return;
  if (type === "boost") car.startBoostT = Math.max(car.startBoostT || 0, cfg.boostSeconds);   // 沿用 v3 完美起跑的免費渦輪管線
  else if (type === "oil") car.oilT = Math.max(car.oilT || 0, cfg.slipSeconds);
  else if (type === "star") { car.stars = (car.stars || 0) + 1; car.turbo = Math.min(1, (car.turbo || 0) + cfg.turboRefill); car.tired = false; }
}

/** 過線:這一圈撿過的清掉 ⇒ 下一圈道具重生(每台車各自)。 */
export function respawnForCar(car) {
  if (car.pickedIds) car.pickedIds.clear();
}

/**
 * AI 對道具的反應(npc-ai-kit「看前方」式):回傳建議的車道偏移(佔半寬比例,−1..1)與是否想加速。
 * 只看前方 lookahead 公尺內最近的一個 ⇒ 靠向加速板/星星、閃開油漬。技巧越高越會用。
 */
export function aiItemBias(car, items, track, lookahead = 34, skill = 0.8) {
  if (!items || !items.length) return { lane: 0, want: false };
  const L = track.length;
  let best = null, bestRel = Infinity;
  for (const it of items) {
    if (car.pickedIds && car.pickedIds.has(it.id)) continue;
    let rel = it.dist - car.trackDist;
    if (rel > L / 2) rel -= L; else if (rel < -L / 2) rel += L;
    if (rel < 2 || rel > lookahead) continue;
    if (rel < bestRel) { bestRel = rel; best = it; }
  }
  if (!best) return { lane: 0, want: false };
  const halfW = Math.max(1, track.halfW);
  const target = best.lateral / halfW;
  const urgency = skill * (1 - bestRel / lookahead);
  if (best.type === "oil") {
    const away = target > 0 ? -1 : 1;                       // 往反側閃
    return { lane: clamp01(away * 0.5 * urgency), want: false };
  }
  return { lane: clamp01(target * urgency), want: best.type === "boost" };
}
const clamp01 = (v) => Math.max(-1, Math.min(1, v));

/** 油漬對抓地的倍率(1 = 沒踩到)。stepCar 用它乘在 grip 上。 */
export function oilGripMul(car) {
  return (car.oilT || 0) > 0 ? ITEM_TYPES.oil.gripMul : 1;
}
