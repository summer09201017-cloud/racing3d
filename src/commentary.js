// commentary.js —— 「遊戲事件 → 播報唸稿」對應(純函數,node 可測)。
// 「字幕/唸稿」雙軌(baked-voice-commentary):字幕可帶動態字(game.say 已經在做),唸稿一律固定句、必在 PHRASES 裡。
// 回傳 null = 這個事件不唸(例如 offtrack/bump 太頻繁會吵)。
export function phraseFor(type, d = {}, mode = "solo") {
  switch (type) {
    case "racestart": return "各位車手,預備!";
    case "countdown": return d.n === 3 ? "三!" : d.n === 2 ? "二!" : d.n === 1 ? "一!" : null;
    case "go": return "出發!";
    case "lap": return d.final ? "最後一圈!" : "又完成一圈!";
    case "wrongway": return "方向反了,請掉頭!";
    case "rescue": return "放回賽道,加油!";
    case "allaidone": return "對手都到了,慢慢來,衝過終點就好!";
    case "perfectstart": return "完美起跑!";
    case "newrecord": return "新紀錄!太厲害了!";
    case "playerfinish": return d.p === 1 ? "二號車手衝線!" : "一號車手衝線!";
    case "finish":
      if (mode === "duel2p") return d.winner === 1 ? "比賽結束!二號車手獲勝!" : "比賽結束!一號車手獲勝!";
      return d.rank === 1 ? "衝線!冠軍!太厲害了!" : d.rank === 2 ? "衝線!第二名,好快!" : d.rank === 3 ? "衝線!第三名,有獎牌!" : "完賽了!跑完全程,真棒!";
    default: return null;
  }
}

/** 給測試對賬用:所有可能被唸出來的句子。 */
export function allCommentaryPhrases() {
  const out = new Set();
  out.add(phraseFor("racestart")); out.add(phraseFor("go"));
  for (const n of [3, 2, 1]) out.add(phraseFor("countdown", { n }));
  out.add(phraseFor("lap", { final: true })); out.add(phraseFor("lap", { final: false }));
  out.add(phraseFor("wrongway")); out.add(phraseFor("rescue")); out.add(phraseFor("allaidone"));
  out.add(phraseFor("perfectstart")); out.add(phraseFor("newrecord"));
  for (const p of [0, 1]) out.add(phraseFor("playerfinish", { p }));
  for (const rank of [1, 2, 3, 4]) out.add(phraseFor("finish", { rank }, "solo"));
  for (const winner of [0, 1]) out.add(phraseFor("finish", { winner }, "duel2p"));
  out.delete(null);
  return [...out];
}
