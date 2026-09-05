// commentary.test.mjs —— 播報對賬(人聲鐵律驗收清單):
//   ① 每個事件會唸的句子都在 PHRASES 裡(唸得出來)②每一句都烤成 mp3 且 manifest 對得上(缺檔=線上靜默、沒人會發現)
//   ③ 專案裡沒有 Web Speech 的實際呼叫 ④ sw 是 network-first 通用快取(沒有手抄 CORE 清單要對賬)
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { PHRASES, voiceKey } from "../src/voicePhrases.js";
import { phraseFor, allCommentaryPhrases } from "../src/commentary.js";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };

const used = allCommentaryPhrases();
ok(used.length >= 15, `會唸的句子 ${used.length} 句`);
for (const s of used) ok(PHRASES.includes(s), `「${s}」在 PHRASES 裡`);
ok(new Set(PHRASES.map(voiceKey)).size === PHRASES.length, "voiceKey 無碰撞");
ok(phraseFor("bump") === null && phraseFor("offtrack") === null, "撞牆/出界不唸(太吵)");
ok(phraseFor("countdown", { n: 3 }) === "三!" && phraseFor("countdown", { n: 0 }) === null, "倒數 3/2/1 唸、0 不唸");
ok(phraseFor("finish", { rank: 1 }) === "衝線!冠軍!太厲害了!" && phraseFor("finish", { rank: 7 }) === "完賽了!跑完全程,真棒!", "單人完賽依名次");
ok(phraseFor("finish", { winner: 1 }, "duel2p") === "比賽結束!二號車手獲勝!", "雙人完賽唸勝者");

// ② mp3 + manifest 對賬
const dir = new URL("../public/voice/", import.meta.url);
ok(existsSync(new URL("manifest.json", dir)), "public/voice/manifest.json 存在(先跑 node scripts/gen-voice.mjs)");
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
const files = new Set(readdirSync(dir).filter((f) => f.endsWith(".mp3")));
for (const s of PHRASES) {
  const k = voiceKey(s);
  ok(manifest[k] === `voice/${k}.mp3`, `manifest 有「${s}」`);
  ok(files.has(`${k}.mp3`), `mp3 存在「${s}」`);
}

// ③ 沒有 Web Speech(禁詞用串接寫,免得守門把測試檔自己攔下)
const banned = new RegExp("speech" + "Synthesis|SpeechSynthesis" + "Utterance");
for (const f of readdirSync(new URL("../src/", import.meta.url))) {
  const src = readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
  ok(!banned.test(src), `${f} 無 Web Speech 呼叫`);
}
// ④ sw:network-first 通用(mp3 會被動快取;沒有 CORE 清單就沒有「手抄漏一支」的坑)
const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
ok(/fetch\(req\)/.test(sw) && !/CORE/.test(sw), "sw 是 network-first 通用快取");
console.log(`commentary.test: ${n} 項通過`);
