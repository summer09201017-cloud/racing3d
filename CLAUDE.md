# racing3d — 3D 賽車・五檔視角(含駕駛座第一人稱)+ 雙人同機

Three.js 街機賽車:自由移動的車體 + 閉環樣條賽道(3 基底 × 4 方向 = 12 條)+ 五檔視角(追尾/車頭/駕駛座/高空俯瞰/轉播機位)+ AI 對手 + 溫柔規則
+ 分割畫面雙人同機 + 預烤人聲播報 + 暫停 / 完美起跑 / 本機紀錄 / 課堂排行房 / 彩帶 + **載具三型(賽車/摩托車/馬,同場混搭)**。
2026-09-05 開工、09-06 v2、09-07 v3 與 v4(規劃見記憶 racing3d-plan)。現況以 `讀我-HANDOFF.txt` ★段為準,待做見 `roadmap.md`。

## 指令

- `npm run dev` / `run.bat` — 本機開發(<http://localhost:5173>)
- `npm test` — 純函數七層 node 直測(track 含 12 條變體 / vehicle / race headless / race2p 雙人+輔助+起跑格 / commentary 播報對賬 / v3 暫停・完美起跑・紀錄 / v4 載具三型・零和平衡),不用瀏覽器
- `npm run build && npm run check:local` — 真瀏覽器驗收(playwright-core+系統 Edge,免下載):起 preview → 開賽真 click → 五檔視角各截一張 → 結算 → **雙人同機分割畫面** → `screenshots/` → 0 pageerror
- `CHECK_URL="https://..." node scripts/browser-check.mjs` — 直驗線上
- `npm run voice` — 重烤人聲 mp3(需網路;只有在 `PHRASES` 加句子後才要跑,累加式)

## 架構(3d-game-kit 三件套 + 純函數層)

| 檔 | 職責 |
|---|---|
| `src/track.js` | ★地基:閉環 Catmull-Rom 等弧長取樣 2000 點 + 高度剖面(smoothstep 關鍵影格)。`posAt(dist)`、`nearest(x,z,hint)`(里程/帶號橫向/高度)、`pointAtOffset`、`tvCameraSpots`。`BASE_TRACKS` 一條賽道一筆資料,加賽道不加程式;`variantOf` 展開 逆走(控制點反序+高度 u→1−u)/ 鏡像(x 取負)⇒ `TRACKS` 12 條 |
| `src/vehicles.js` | **v4 載具資料層**(純資料,不 import THREE):`VEHICLES` 三型 = 參數倍率 `over` + 駕駛座眼位 `eye` + 車頭眼位 `hood` + 音色 + 衝刺條名稱 + 說明;`vehicleParams(id)` = `{...CAR, accelMul:1, gripMul:1, ...over}`(賽車逐鍵 == CAR ⇒ 舊 77 項車體測試不變);`aiVehicleFor(i, offset)` 混搭 |
| `src/rigs.js` | **v4 摩托車/馬的 3D 外型**,與 `_makeCarRig` 同一回傳契約(多 `kind` / `leanIn` / `anim`)。馬照 mount-riding-kit 馬體鐵則(矩形身體、長腿 v3、鬃毛三件套、雙眼雙耳);騎士照 3d-figure-kit 臉部鐵則(眼白+瞳孔+微笑+耳前無髮) |
| `src/vehicle.js` | 街機車體純函數 `stepCar`:油門/煞車/倒車、轉向率隨速度、橫向滑移(甩尾)、渦輪計費(遲滯)、出界變慢、撞牆彈開、逆向偵測、卡住自動救援、圈數。**`ASSIST` PD 輔助**與 `assistStrength()` 三態。`resolveCollisions` 車對車溫柔推開。`DIFFICULTY` 五檔 |
| `src/ai.js` | 對手腦:追前方車道點 + 彎前煞車 `v=sqrt(latAcc/k)` + 閃避 + 溫柔橡皮筋 + 渦輪(同一套計費) |
| `src/game.js` | THREE 場景(換賽道=換整個 Scene)、車體 rig(外殼+車內組)、**`cams` 雙視窗鏡頭**、狀態機 menu→countdown→racing→finished、名次/結算。不碰 DOM;headless 可在 node 跑整場 |
| `src/main.js` | UI 接線:選單(賽道=基底 + 方向兩個下拉合成 trackId)/HUD(單人與分割雙份)/小地圖/鍵盤/觸控/手把 → `game.input` / `game.input2`、音效、人聲、beacons、PWA;**v3** 暫停蓋版與 P/Esc/Start、紀錄顯示(首頁/HUD/結算)、彩帶、排行房 report |
| `src/records.js` | 本機最佳紀錄純函數:`applyResult`(不改原物件,回 new/prev)、`getRecord`、`normalizeRecords`;key=`賽道|難度`(單圈)與 `賽道|圈數|難度`(總時間);localStorage 包 try/catch;日期用本地 `todayStr` 不用 toISOString |
| `src/confetti.js` | win-confetti 原樣收割:`celebrate()` 從上灑落 2.2 秒自己清乾淨,reduced-motion no-op,canvas 帶 `data-confetti`(驗收用) |
| `src/audio.js` | Web Audio 合成:引擎聲(轉速跟車速)、渦輪、撞牆、輪胎滑、倒數、圈數、完賽(零音檔) |
| `src/voicePhrases.js` / `scripts/gen-voice.mjs` / `src/voice.js` / `src/commentary.js` | 人聲播報三件套 + 事件對應。**鐵律:預烤 mp3(雲哲神經語音),絕不用 Web Speech 機器聲;缺檔=靜默只出字幕** |

## 座標與符號鐵則(測試釘死,改動前必讀)

- 車頭 `forward = (sin h, cos h)`、右手 `right = (−cos h, sin h)`;track 的 `rightOfTangent = (−tz, tx)` 同一套。車體 mesh 面向 +z 建構。
- **按右 steer=+1 ⇒ heading 遞減**(從上看順時鐘);前輪 `pivot.rotation.y = −steer·0.5`;方向盤 `wheel.rotation.z = +steer·1.7`(對駕駛=順時鐘);儀表針 `θ = 330° + frac·240°`(θ=0 指駕駛的左,+ 為順時鐘)。
- 曲率 `k > 0 = 右彎`;急彎標誌立在外側 `side = −sign(k)`。
- 起跑格索引 0 = 最前格,一排兩台;`d = L − 6 − row·7.5`,`progress = −(L − d)` 起跑為負,跨線後 ≥0;`lap = floor(progress/L)`。
  預設玩家排**最後一排**(後面沒車擋追尾鏡頭、超車才好玩),選單可改最前排;雙人一定同一排(P1 左 P2 右,跟分割畫面一致)。
- 雙人:`car.playerIdx` = 視窗索引 = `cams` 索引 = P1/P2。單閘門 `is2P()`,別另開旗標。
- 賽道 id:基底 `meadow`;變體 `meadow-rev` / `meadow-mir` / `meadow-mirrev`(`trackIdOf(base, variant)`)。正走 label 不加後綴,變體加「・逆走」等;`TRACKS[id].base / .variant` 給選單還原。變體是不同賽道 ⇒ 紀錄分開。

## v4 載具(0907 使用者拍板:首批摩托車+馬、同場混搭)

- **一條鐵則**:**極速由難度管、載具只換手感**,每型取捨零和(轉得快就抓地差、越野強就起步慢)。否則幼兒選馬 60 km/h 對上職業賽車 180 km/h,場面不成立。
- **參數包**:`stepCar` 開頭 `const P = car.params || CAR`,原本 23 處 `CAR.x` 全改 `P.x`;`cfg.accel` 乘 `accelMul`、`cfg.grip` 乘 `gripMul`(**難度的極速 `cfg.maxSpeed` 刻意不乘**)。`resolveCollisions` 改用兩台各自的 width/length 取平均 ⇒ 摩托車 0.9m 真的鑽得過。
- **平衡校正**(0907 掃 8 組,草原一圈自動駕駛):賽車 45.4s / 摩托車 46.1s(grip 0.9・accel 1.15)/ 馬 44.6s(grip 1.08・accel 0.88),差 **3.2%**;`vehicles.test` ③ 守 ≤10%,改參數會當場紅。
- **AI 混搭**:`vOff = mulberry(1000 + raceNo*7919)()` 決定起點,第 i 台拿 `VEHICLE_IDS[(i+vOff) % 3]` ⇒ 每場排列不同、≥2 台一定不同種。
- **rig 契約**:`{ group, tilt, wheels, hide, flame, cockpit, tailMat|null, paint, kind, leanIn, anim|null }`。`_syncRig` 對 `flame`/`tailMat`/`anim`/`needlePivot` 全部先判 null(馬沒有煞車燈與速度表)。`cockpit.userData` 改成 `{ wheel, wheelAxis, wheelGain, needlePivot }`:賽車方向盤 z×1.7、馬韁 y×−0.25、摩托車把手在前叉(gain 0,靠 `wheels[0].pivot` 那一份轉向)。
- **傾身**:`rig.leanIn` 為真(摩托車)⇒ `rollT = clamp(−yawRate·speed·0.02, ±0.45)` **內傾壓車**;賽車/馬維持原本的外傾 ±0.14。
- **馬**:`wheels` 是空陣列(沒有輪子),`wheelRadius: 1.0` 讓 `car.wheelSpin` 直接當奔跑相位(每 2π 公尺一步);`anim(car)` 跑四腿 sin 相位 [0, π/2, π, 3π/2] + 身體 bob + 頸點頭 + 尾擺。
- **音色**:`audio.setEngine(..., kind)`——`engine` 賽車原樣、`moto` 基頻 95Hz 起跳且方波同音高(更「鑽」)、`hooves` 把引擎音量歸零改放跟速度的馬蹄噠噠(站著不動就安靜)。

## v3 規則(0907,改動前先讀)

- **暫停**=`update()` 早退(`this.paused`),連 `this.time`、訊息計時、鏡頭都不推;`render()` 照畫最後一幀。只在 countdown/racing 可暫停(`setPaused` 回 false 表示拒絕),startRace/backToMenu 一律清掉。UI 端:P / Esc / ⏸ 鈕 / 手把 Start;玩法說明在比賽中打開=順手暫停(關掉就繼續);`visibilitychange` hidden ⇒ 自動暫停、**不自動繼續**。
- **完美起跑**:`PERFECT_START = { hold 1.2, window 0.6, boostSeconds 1.4, aiChance 0.5 }`。倒數期間只累計 `car.holdT`(油門連續按住幾秒);GO 後前 window 秒第一次踩油門判一次(`_judgeStarts`):`holdT ≤ hold` ⇒ `startBoostT = boostSeconds`,否則只提醒。**免費渦輪的做法=每幀強制 `input.boost=true`、stepCar 完把 turbo/tired 退回**,不碰 vehicle.js;stepCar 的 boost/boostend 事件照發(火焰/音效自然對)。AI 在 GO 那一幀用 `brain.rnd() < aiSkill × aiChance` 決定。autopilot 不判。
- **AI 種子每場輪換**:`makeAiBrain(0.137 + i·0.311 + ((raceNo−1) % 97)·0.0071)`;同一個 RacingGame 的第一場永遠一樣(測試可重現),「再來一場」會不一樣。
- **紀錄**只在 UI 層(main.js showResults)套 `applyResult`;game.js 只在 results 多帶 `trackId / difficultyId / trackLength / bestLap2`。第一次跑=「記下」不慶祝;`prev > 0` 且更快才是 🏆 + 人聲(延遲 2.6 秒等衝線那句唸完)。
- **排行房分數**=`round(平均時速 km/h)`(rank.js 只認「越大越好的整數」,沒有格式化選項);只在單人回報,雙人不報。

## 極速調校(0906,改 `DIFFICULTY` 前先讀)

`maxSpeed` 不是單獨一顆旋鈕。油門加速度是 `accel·(1−frac·0.6)`,而阻力是 `roll + drag·v²`,
所以**極速拉高但 accel/drag 沒跟著調,車會永遠到不了新極速**(職業檔實測只到 94%)。
0906 的組合:每檔 accel 同步加大 + `drag 0.0032→0.0024` ⇒ 五檔都能在 5 秒內到 90% 極速。
`brake 15→17`(180 km/h 仍 3 秒內煞停)、`highSpeedFalloff 24→30`(50 m/s 時還有 0.34 轉向)、
追尾鏡頭速度感基準 `34→44`。**AI 的 `aiMax` 每檔都要低於玩家 `maxSpeed`**(測試釘死)。

## 本專案地雷(實踩,勿重踩)

1. 橫向滑移那一行**要乘 dt**(漏掉=每幀灌一秒的滑移,車在直線上左右擺到出牆,極速只到 6 m/s)。
2. 路面帶狀網格繞序 `idx.push(a, b, c, b, d, c)`:反了法線朝下=整條路被背面剔除,截圖看到「車在草地上跑」而所有測試全綠(判定層用的是 samples 不是 mesh)。**方向/可見類的錯要靠截圖,不能靠測試。**
3. 追尾鏡頭**位置剛性、只平滑方向**:位置 lerp 在加速時落後 4~7 m,起跑第二排的車剛好卡在鏡頭裡。
4. 駕駛座:後視鏡/頂梁要放在擋風玻璃頂(離眼 ~0.9 m),放 0.3 m 會佈滿三分之一畫面;`near=0.05` 否則方向盤被裁;車艙/窗/駕駛頭用 `rig.hide` 一次藏,`visible` 一律嚴格 boolean。
5. `mesh.visible` 一律 `!!`(0827 全艦隊通則);`this.running` 只給 RAF。
6. 玩法說明(`#helpOverlay`)第一次開賽自動跳一次,browser-check 截圖前要真 click 關掉。
7. main.js 每幀從鍵盤/觸控/手把**覆寫** `game.input` ⇒ 測試想操控玩家要用真鍵盤(`page.keyboard.down`)或 `game.autopilot`。
8. **輔助不能是純 P 控制**(0906):只有位置誤差項,在極速提高後會左右盪過頭——kids 檔只給油 20 秒撞牆從 17 次變 **23** 次,**開輔助比不開還糟**。加 D 項(`car.latRate` 每秒往外飄幾公尺)煞住回中線的動作才對:草原幼兒 17→**0**。參數 `ASSIST.kP/kD` 是掃 20 組選的,別憑感覺改。
9. **輔助要在出界時也作用**(0906):原本 `!car.offTrack` 才跑,等於「已經滑到草地上」那一刻放生——而那正是最需要被扶的時候。職業檔 20 秒有 16 秒在草地上,所以看起來「輔助沒用」。
10. **極速夾限**(0906):`drag` 變小後,`v` 會在極速上下抖 ±0.1,`vehicle.test` 的「不超過極速」會紅。要加「這幀不越過極速」的夾限,不是改測試。
11. **雙人的駕駛座藏車艙要「每一刀各自判斷」**:同一個 scene 畫兩次,只有「該視窗車手自己選駕駛座」才藏他的車艙,對手的車艙照常顯示。`render()` 每刀前呼叫 `_applyCockpitHide(i)`,畫完還原 `-1`。
12. **`trackDist` 不能拿來比「是不是同一排」**(0906 測試踩到):它是 `nearest()` 從 2000 點取樣算的,兩台車橫向偏移不同時會落在不同取樣點,誤差可達公尺級。要比同排請比 `progress`(那是程式直接設的,精確)。
13. **本 repo 的 .js 是 CRLF**(0906 踩到):寫補丁腳本用 `indexOf` 比對多行片段會全部找不到。先 `split("\r\n").join("\n")`、寫回時還原。
14. **rank.js 的 🏆 浮鈕釘在 top 112px 左側 8~56px**(0907 截圖抓到):左上 `.race-card` 原本 left 12px 會被它蓋住「第 N 名」那行 ⇒ 卡片 left 改 62px。任何新浮鈕先看 index.html 尾端那些跨站 script 各佔哪個角。
15. **玩法說明打開=順手暫停**(v3):browser-check 第一次開賽會自動跳說明,腳本一定要真 click 關掉才會倒數(現有腳本本來就這樣做,但新增測試別假設「開賽 N 秒後一定 racing」)。
16. **AI 完美起跑的測試不能釘單場**(0907):種子固定 ⇒ 單場結果固定,「5 台全中」單場機率 3% 但一旦發生就永遠發生;改用六場合計區間 + kids < hard(見 v3.test ②)。
18. **馬背駕駛座眼位要高過騎士頭**(0907 截圖抓到):`eye.y` 放 2.74(騎士眼高)時**馬頭正好擋在畫面正中央**;抬到 2.98、z 往後 0.1 才看得到前方。任何新載具的第一人稱都要真的截一張圖看,測試只驗「鏡頭在載具上、數值有限」,擋不擋視線它不知道。
17. **判斷檔案 LF/CRLF 用 node 不用 Git Bash 的 grep**(0907):`grep -q $''` 在這台的 Git Bash 對 CRLF 檔也回「LF」,害補丁腳本第一次錨點全找不到;`node -e` 讀進來 `includes("
")` 才準(本 repo 現況:src/*.js 與 styles.css 是 CRLF,md/html/json 是 LF)。

## 部署

**2026-09-07 起:Cloudflare Workers assets** — <https://hfpc-racing3d.summer09201017.workers.dev>
源碼 GitHub `summer09201017-cloud/racing3d`(main)。

★★ **部署指令換了,別再跑 netlify deploy** ★★
```
npm test && npm run build && npx wrangler deploy --name hfpc-racing3d --assets dist --compatibility-date 2026-07-01
→ CHECK_URL=https://hfpc-racing3d.summer09201017.workers.dev node scripts/browser-check.mjs
```
舊 Netlify site `4d240b0c-e780-4962-bf85-30779e678b64` **現在是 301 轉址殼**(`_redirects` 一行 + 說明頁);
往它 deploy 會把轉址殼蓋掉、變成兩份會分岔的內容。轉址殼源碼沒進版控(三個檔,要重建看本段末)。

- **搬遷沿革**:0905 建站時 CF 帳號 0903 起 ToS 審查,0904 使用者拍板「凍結期間純靜態新站先上 Netlify、站名加 `new-` 前綴」⇒ v1~v4 都在 Netlify。**0907 使用者拍板搬 CF Workers**(見下)。
  ⚠ **為什麼是 Workers 不是 Pages**:CF 帳號被擋的**只有「建新 Pages 專案」**(code 8000030;四個不相關名字全被拒 ⇒ **帳號層級**,不是某個名字被封),**建新 Worker 名沒被擋**(0907 三次獨立實測 + 憫安站真的上線)⇒ 走 Workers assets,不必等申訴。想要 `pages.dev` 網址才要等桌面 `Cloudflare申訴信-2026-09-03.txt` 寄出並通過。
  ★ **為什麼趁 0907 搬**:換 origin 會讓玩家的**本機最佳紀錄(localStorage)歸零**——0907 統計是 2 開 1 完、全是驗收場,**還沒有孩子玩過**,所以這個代價當下等於零;一旦主日學用過就再也回不到這個價格。
  ★ **舊 Netlify 站的 301 殼**(源碼不在版控,三個檔,要重建時照抄):`_redirects` = `/*  https://hfpc-racing3d.summer09201017.workers.dev/:splat  301!`、`netlify.toml` = `[build] ignore = "exit 0"`、一頁 `index.html`(meta refresh + canonical + 一行「請把書籤改成新網址」)。部署:`npx netlify deploy --prod --dir . --site 4d240b0c-e780-4962-bf85-30779e678b64 --no-build`。
- **更新流程(★ git push 不會上線,一定要重跑 deploy)**:見本段開頭的 wrangler 指令。殼層(index.html / sw.js / manifest / voice)有改就 bump sw `CACHE`(目前 `racing3d-v4`)。
  ⚠ `--assets dist` 只上傳 build 產物 27 檔(源碼/設定/測試/文件都不在裡面,0907 逐條 curl 驗過全 404)⇒ **不需要 `.assetsignore`**(那只有 `--assets .` 才要)。
- psPing id `racing3d`(index.html)、`racing3d-done` / `racing3d-dwell`(main.js)——beacon 只排除 localhost、不認 hostname,**換平台不用改、統計不斷線**;verTag 在 `index.html #verTag`。
- **帳本(0907 搬站後現況)**:實際帶網址的只有**三處**,0907 都已改成 workers.dev 並線上驗過:①奧運頁卡 `Desktop/hfpc-olympics/index.html`(改完要 `wrangler deploy --name hfpc-olympics --assets .`)②作品集 `hfpc-portfolio/data.js`(同樣 wrangler)③`hfpc-claude-skills` 的 `references/machine-env-0714/gamefleet/sites.json`。
  ⚠ 另外兩個「看起來要改其實不用」:play-stats 的 `worker.js` NAMES 只有中文名**沒有網址**;`Downloads/hfpc/hfpc-claude-skills` 那份 sites.json 是**舊快照夾**(停在 v156),不是活正本,別去改它。
