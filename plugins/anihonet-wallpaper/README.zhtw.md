# anihonet 動漫壁紙 - 外掛說明

本外掛從 [anihonetwallpaper.com](https://anihonetwallpaper.com) 抓取壁紙並加入下載佇列。支援 **排行榜** 與 **作品索引（アニメ・ゲーム一覽）** 兩種模式，預設排行榜以相容舊設定。

## 爬取模式（crawl_mode）

| 值 | 說明 |
|----|------|
| **ranking**（預設） | 依週期爬排行列表頁，再進入各作品詳情下載 |
| **anime_game** | 從 [作品タイトル一覧](https://anihonetwallpaper.com/anime-game-wallpaper) 依假名行勾選 → 主題列表頁 → 作品詳情 → 原圖連結 |

切換為「作品索引」後會出現 **假名行（anime_game_rows）** 多選：あ／か／さ／た／な／は／ま／や／ら／わ（對應頁面 `h3` 的 `id`：a, ka, sa, …）。

## 排行榜模式

1. 依 **起始頁／結束頁／排行榜週期** 開啟排行 URL（如 `ranking-daily-imgpc/1`）。
2. 列表頁會收集頁面上所有 `<a>` 的 `href` 並依序進入（數量可能含導覽等連結）。
3. 詳情頁以 **`a.button:not(.add)`** 取得下載按鈕 `href`（排除獨立類名 `.add`，與 `add-dl` 區分）。

**進度（任務 100%）**：**列表頁均分 → 頁內每條連結均分 → 詳情內每張圖均分**；每條下載連結處理完（含跳過）計一次。若某頁 0 個 `a`，該頁份額一次加完；若詳情 0 個按鈕，該作品份額一次加完。

## 作品索引模式

1. 開啟 `anime-game-wallpaper`，依勾選行從 HTML 解析各主題入口 `<a href>`。
2. **主題作品列表頁**以 **`.itiran:last-of-type > a`** 的 `href` 進入各作品詳情（與瀏覽器 `$$('.itiran:last-of-type > a')` 一致）。
3. 詳情頁以 **`a.button.add-dl`** 作為原圖下載按鈕。

**進度（任務 100%）**：**主題（每個列表入口）均分 → 主題內作品均分 → 作品內每張圖均分**；跳過、過濾仍計入該圖份額。

## 壁紙類型與過濾

- **壁紙類型（wallpaper_type）**：`imgpc` 僅桌面圖；`sp` 僅手機圖。依圖片 URL **檔名**是否含 `Android`（不分大小寫）判定。
- **原圖**：URL 含 **`resize`**（不分大小寫）視為縮圖，**不下載**。

## 設定項摘要

| 鍵 | 說明 | 顯示條件 |
|----|------|----------|
| **crawl_mode** | `ranking` / `anime_game` | 始終 |
| **anime_game_rows** | 假名行多選 | 僅 anime_game |
| **start_page / end_page** | 排行頁 1–5 | 僅 ranking |
| **ranking_period** | daily／weekly／monthly／annual | 僅 ranking |
| **wallpaper_type** | imgpc／sp | 始終 |

## 使用建議

- 只要手機壁紙：壁紙類型選「手機壁紙」。
- 只要桌面壁紙：壁紙類型選「桌面壁紙」。
- 作品索引資料量可能很大，請先縮小假名行；日誌中 `[anihonet]` 前綴可查看目前頁面與下載嘗試。

楽しんで～
![image](./image.jpg)
