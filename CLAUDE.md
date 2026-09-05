# racing3d — 3D 賽車・五檔視角(含駕駛座第一人稱)+ 雙人同機

Three.js 街機賽車:自由移動的車體 + 閉環樣條賽道 + 五檔視角(追尾/車頭/駕駛座/高空俯瞰/轉播機位)+ AI 對手 + 溫柔規則
+ 分割畫面雙人同機 + 預烤人聲播報。
2026-09-05 開工、09-06 v2(規劃見記憶 racing3d-plan)。現況以 `讀我-HANDOFF.txt` ★段為準,待做見 `roadmap.md`。

## 指令

- `npm run dev` / `run.bat` — 本機開發(<http://localhost:5173>)
- `npm test` — 純函數五層 node 直測(track / vehicle / race headless / race2p 雙人+輔助+起跑格 / commentary 播報對賬),不用瀏覽器
- `npm run build && npm run check:local` — 真瀏覽器驗收(playwright-core+系統 Edge,免下載):起 preview → 開賽真 click → 五檔視角各截一張 → 結算 → **雙人同機分割畫面** → `screenshots/` → 0 pageerror
- `CHECK_URL="https://..." node scripts/browser-check.mjs` — 直驗線上
- `npm run voice` — 重烤人聲 mp3(需網路;只有在 `PHRASES` 加句子後才要跑,累加式)

## 架構(3d-game-kit 三件套 + 純函數層)

| 檔 | 職責 |
|---|---|
| `src/track.js` | ★地基:閉環 Catmull-Rom 等弧長取樣 2000 點 + 高度剖面(smoothstep 關鍵影格)。`posAt(dist)`、`nearest(x,z,hint)`(里程/帶號橫向/高度)、`pointAtOffset`、`tvCameraSpots`。`TRACKS` 一條賽道一筆資料,加賽道不加程式 |
| `src/vehicle.js` | 街機車體純函數 `stepCar`:油門/煞車/倒車、轉向率隨速度、橫向滑移(甩尾)、渦輪計費(遲滯)、出界變慢、撞牆彈開、逆向偵測、卡住自動救援、圈數。**`ASSIST` PD 輔助**與 `assistStrength()` 三態。`resolveCollisions` 車對車溫柔推開。`DIFFICULTY` 五檔 |
| `src/ai.js` | 對手腦:追前方車道點 + 彎前煞車 `v=sqrt(latAcc/k)` + 閃避 + 溫柔橡皮筋 + 渦輪(同一套計費) |
| `src/game.js` | THREE 場景(換賽道=換整個 Scene)、車體 rig(外殼+車內組)、**`cams` 雙視窗鏡頭**、狀態機 menu→countdown→racing→finished、名次/結算。不碰 DOM;headless 可在 node 跑整場 |
| `src/main.js` | UI 接線:選單/HUD(單人與分割雙份)/小地圖/鍵盤/觸控/手把 → `game.input` / `game.input2`、音效、人聲、beacons、PWA |
| `src/audio.js` | Web Audio 合成:引擎聲(轉速跟車速)、渦輪、撞牆、輪胎滑、倒數、圈數、完賽(零音檔) |
| `src/voicePhrases.js` / `scripts/gen-voice.mjs` / `src/voice.js` / `src/commentary.js` | 人聲播報三件套 + 事件對應。**鐵律:預烤 mp3(雲哲神經語音),絕不用 Web Speech 機器聲;缺檔=靜默只出字幕** |

## 座標與符號鐵則(測試釘死,改動前必讀)

- 車頭 `forward = (sin h, cos h)`、右手 `right = (−cos h, sin h)`;track 的 `rightOfTangent = (−tz, tx)` 同一套。車體 mesh 面向 +z 建構。
- **按右 steer=+1 ⇒ heading 遞減**(從上看順時鐘);前輪 `pivot.rotation.y = −steer·0.5`;方向盤 `wheel.rotation.z = +steer·1.7`(對駕駛=順時鐘);儀表針 `θ = 330° + frac·240°`(θ=0 指駕駛的左,+ 為順時鐘)。
- 曲率 `k > 0 = 右彎`;急彎標誌立在外側 `side = −sign(k)`。
- 起跑格索引 0 = 最前格,一排兩台;`d = L − 6 − row·7.5`,`progress = −(L − d)` 起跑為負,跨線後 ≥0;`lap = floor(progress/L)`。
  預設玩家排**最後一排**(後面沒車擋追尾鏡頭、超車才好玩),選單可改最前排;雙人一定同一排(P1 左 P2 右,跟分割畫面一致)。
- 雙人:`car.playerIdx` = 視窗索引 = `cams` 索引 = P1/P2。單閘門 `is2P()`,別另開旗標。

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

## 部署

**2026-09-06 v2 上線 Netlify(direct upload,未接 GitHub auto-build)**:<https://new-hfpc-racing3d.netlify.app>
site id `4d240b0c-e780-4962-bf85-30779e678b64`;源碼 GitHub `summer09201017-cloud/racing3d`(main)。

- **為什麼不是 CF**:Cloudflare 帳號 2026-09-03 起 ToS 審查(CF 原信只禁「加新網域」;「不建新 Pages/Worker」是我們 0903 自訂的預防規則),0904 使用者拍板「凍結期間純靜態新站先上 Netlify、站名加 `new-` 前綴」。審查解除後再搬 CF Pages(`hfpc-racing3d`),見 `roadmap.md` 待做第 1 項。
- **更新流程(★ git push 不會上線,一定要重跑 deploy)**:
  `npm test && npm run build && netlify deploy --prod --dir dist --site 4d240b0c-e780-4962-bf85-30779e678b64 --no-build`
  → `CHECK_URL=https://new-hfpc-racing3d.netlify.app node scripts/browser-check.mjs`。殼層(index.html / sw.js / manifest / voice)有改就 bump sw `CACHE`(目前 `racing3d-v2`)。
- psPing id `racing3d`(index.html)、`racing3d-done` / `racing3d-dwell`(main.js)——beacon 只排除 localhost、不認 hostname,Netlify 上照常打;verTag 在 `index.html #verTag`。
- **帳本四處 2026-09-06 已登記**(由 0905-bb 場完成並逐站驗過):奧運頁卡(`Desktop/hfpc-olympics`,dca2e9c)、作品集(7c0fcad)、play-stats NAMES+versions(87ec829)、sites.json 兩份。搬 CF 時這四處的網址要一起改。
