// voicePhrases.js —— 播報詞庫(固定唸稿)+ voiceKey;烤製(scripts/gen-voice.mjs)與 runtime(voice.js)共用。
// ★ 人聲鐵律(baked-voice-commentary,2026-07-10 使用者拍板):一律預烤 mp3 神經人聲(雲哲=男聲轉播感),絕不用 Web Speech 機器聲。
// 只放「實際會唸」的固定句;事件→句子的對應在 commentary.js(純函數,測試會對賬:每一句都要在這裡、也要在 manifest 裡)。
export function voiceKey(text) {
  let h = 0x811c9dc5;
  const s = String(text).replace(/\s+/g, "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const PHRASES = [
  "各位車手,預備!",
  "三!",
  "二!",
  "一!",
  "出發!",
  "又完成一圈!",
  "最後一圈!",
  "方向反了,請掉頭!",
  "放回賽道,加油!",
  "對手都到了,慢慢來,衝過終點就好!",
  "衝線!冠軍!太厲害了!",
  "衝線!第二名,好快!",
  "衝線!第三名,有獎牌!",
  "完賽了!跑完全程,真棒!",
  "一號車手衝線!",
  "二號車手衝線!",
  "比賽結束!一號車手獲勝!",
  "比賽結束!二號車手獲勝!",
  "完美起跑!",
  "新紀錄!太厲害了!",
];
