// records.js —— 本機最佳紀錄(v3,0907):純函數 + localStorage 包 try/catch(Safari 私密模式不炸)。
//   最佳單圈 key = 賽道|難度(圈數不影響單圈,1 圈練的紀錄 3 圈也算)
//   最佳總時間 key = 賽道|圈數|難度
//   逆走/鏡像是不同的 trackId(meadow-rev…)⇒ 紀錄自然分開。零個資:只存秒數與日期,不存名字。
export const REC_KEY = "racing3d-records-v1";
export const lapKey = (trackId, difficulty) => `${trackId}|${difficulty}`;
export const timeKey = (trackId, laps, difficulty) => `${trackId}|${laps}|${difficulty}`;

export function emptyRecords() { return { lap: {}, time: {} }; }

/** 亂值/舊格式 → 乾淨的 { lap:{}, time:{} }(深拷貝,呼叫端拿到的是新物件)。 */
export function normalizeRecords(r) {
  const out = emptyRecords();
  if (!r || typeof r !== "object") return out;
  for (const bucket of ["lap", "time"]) {
    const src = r[bucket];
    if (!src || typeof src !== "object") continue;
    for (const [k, v] of Object.entries(src)) {
      const t = v && typeof v === "object" ? Number(v.t) : Number(v);
      if (Number.isFinite(t) && t > 0) out[bucket][k] = { t, date: v && typeof v === "object" && typeof v.date === "string" ? v.date : "" };
    }
  }
  return out;
}

/** 讀某組設定的紀錄;沒有=0(呼叫端用 truthy 判斷)。 */
export function getRecord(records, trackId, laps, difficulty) {
  const r = normalizeRecords(records);
  const t = r.time[timeKey(trackId, laps, difficulty)], l = r.lap[lapKey(trackId, difficulty)];
  return { time: t ? t.t : 0, timeDate: t ? t.date : "", lap: l ? l.t : 0, lapDate: l ? l.date : "" };
}

/**
 * 把一場結果套進紀錄(純函數:回傳新的 records,不改傳入的)。
 * 回傳 { records, newTime, newLap, prevTime, prevLap }:prevX = 這場之前的紀錄(0=以前沒有)。
 */
export function applyResult(records, { trackId, laps, difficulty, time, bestLap, date = "" }) {
  const r = normalizeRecords(records);
  const out = { records: r, newTime: false, newLap: false, prevTime: 0, prevLap: 0 };
  const tk = timeKey(trackId, laps, difficulty), lk = lapKey(trackId, difficulty);
  const prevT = r.time[tk], prevL = r.lap[lk];
  out.prevTime = prevT ? prevT.t : 0;
  out.prevLap = prevL ? prevL.t : 0;
  if (Number.isFinite(time) && time > 0 && (!prevT || time < prevT.t)) { r.time[tk] = { t: time, date }; out.newTime = true; }
  if (Number.isFinite(bestLap) && bestLap > 0 && (!prevL || bestLap < prevL.t)) { r.lap[lk] = { t: bestLap, date }; out.newLap = true; }
  return out;
}

export function loadRecords() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(REC_KEY) : null;
    return normalizeRecords(raw ? JSON.parse(raw) : null);
  } catch { return emptyRecords(); }
}

export function saveRecords(records) {
  try { localStorage.setItem(REC_KEY, JSON.stringify(normalizeRecords(records))); } catch { /* 私密模式等:靜默 */ }
}

/** 本地日期 yyyy-mm-dd(不用 toISOString:台灣晚上 8 點後會變成隔天,系列老雷)。 */
export function todayStr(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
