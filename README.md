# 🏎️ 3D 賽車・駕駛座視角(racing3d)

給主日學孩子玩的 3D 賽車:三條賽道(草原/沙漠/雪山)、AI 對手 0~5 台、難度五檔、渦輪加速,
以及**五檔視角**——追尾跟隨、車頭、**駕駛座第一人稱(方向盤跟著轉、儀表指針跟著速度)**、高空俯瞰、轉播機位。
V 鍵或「視角」鈕循環,數字鍵 1~5 直跳,選擇會記住。

溫柔規則:撞牆只彈開掉速、不翻車;開到草地變慢;卡住 2.5 秒自動放回賽道(或按 R);開反方向會提醒掉頭;人人跑得完,結算都有獎牌。

## 玩

```bash
npm install
npm run dev        # 或雙擊 run.bat
```

鍵盤:↑/W 油門、↓/S 煞車(停住後繼續按=倒車)、←→/AD 轉向、Shift 渦輪、空白鍵手煞甩尾、V 視角、R 回賽道、H 玩法、Esc 選單。
手機:左下 ◀▶ 轉向、右下 油門/煞車/⚡;直向會提示轉橫、開賽自動全螢幕。手把:A 油門、B 煞車、X 渦輪、Y 視角。

## 測

```bash
npm test                              # node 純函數三層(賽道/車體/整場 headless)
npm run build && npm run check:local  # 真瀏覽器截圖驗收(Edge,免下載)→ screenshots/
```

## 結構

`src/track.js`(賽道純算術)→ `src/vehicle.js`(車體物理)→ `src/ai.js`(對手)→ `src/game.js`(THREE 場景/視角/狀態機)→ `src/main.js`(UI)。詳見 `CLAUDE.md`。
