# yande.re 動漫桌布 - 插件說明

本插件用於從 `yande.re` 爬取高解析度動漫桌布並加入下載佇列。站台跑的是 Moebooru
（和 konachan 同一套程式），因此列表頁 / 詳情頁的結構與 konachan 插件同構。

## 爬取模式

- **全部（all）**：全站最新作品（`/post?page=N`）
- **標籤（tags）**：依標籤組合檢索（`/post?tags=a+b&page=N`）
- **排行榜（popular）**：站台的人氣榜。日榜 / 週榜 / 月榜（`/post/popular_by_day|week|month`）可以依日期看往期；最近 24 小時 / 一週 / 一個月 / 一年（`/post/popular_recent`）是滾動區間，只有當期。每期只有一頁、最多 40 張

## 設定項

- **標籤組合（mode_tag_value）**：列表輸入，執行時用 `+` 連接；標籤裡的空格自動轉底線 `_`
- **分級過濾（rating）**：不限 / 全年齡(Safe) / 存疑(Questionable) / 限制級(Explicit)。
  全部和標籤模式把 `rating:safe` 這樣的元標籤拼進搜尋串，排行榜模式由插件依每張圖的分級篩選
- **排序（sort_order）**：最新發布 / 高分優先 / 解析度優先 / 隨機，對應站台的 `order:` 元標籤
- **起始頁面 / 結束頁數（start_page / end_page）**：一次最多 100 頁，**每頁固定 40 張**
- **排行榜類型 / 排行榜日期 / 回溯期數（popular_scale / popular_date / popular_periods）**：排行榜模式用。日期留空為當期，回溯期數是從該日期起往前連抓多少期，一次最多 100 期
- **畫質（quality）**：
  - **高（high）**：Options 區「View larger version」的原檔直連，沒有原檔時自動降級
  - **中（medium）**：站台縮放後的 `#image` sample

## 中繼資料

每張圖都會帶上從詳情頁解析的中繼資料，圖片詳情側欄用 `description.ejs` 繪製：

- `sidebar_tags`：側欄標籤的 `name` / `display` / `type` / `count` / 站內檢索連結 / wiki 連結
- `stats`：`post_id`、`size`、`rating`、發布時間（相對文案 + `title` 裡的絕對時刻）、
  收藏者列表（最多 24 人，另存總數 `favorited_total`）
- `posted_by_name` / `posted_by_href`、`source_href`、`score`
- `related`：詳情頁的 Related Posts（上一張 / 下一張 / 隨機）
- **`comments`：詳情頁下方的留言區**——作者、頭像、相對時間（含 `title` 上的絕對時刻）、
  內文，最多 30 則，另存總數 `comment_total`

下載時側欄標籤會依類型寫入應用的「標籤」分區（`yandere/artist`、`yandere/character` 等），可在畫冊頁瀏覽、在搜尋裡依標籤篩選。

圖庫的插件擴充裡可以依 **分數**（`5+` … `1000+` 檔位，路徑段也支援 `100-500`、`100+`、`-50` 這樣的區間）和 **分級**（Safe / Questionable / Explicit）篩選已下載的圖。

## 注意事項

- **每頁 40 張是站台寫死的**，未登入時 URL 上沒有可用的每頁筆數參數。
- **收藏者與留言會被截斷**（24 人 / 30 則）。熱門帖的收藏者可以有上千人，
  中繼資料整筆進庫並參與畫冊列表查詢，不截斷會明顯拖慢畫冊。
- **請文明爬取**：一次最多 100 頁，超過會拒絕執行；結束頁面必須 ≥ 起始頁面。
- 站內成人內容與全年齡內容混排，只想要乾淨圖請把「分級過濾」選成全年齡(Safe)。
- 這個站的原圖動輒七八千像素、數十 MB，用「高」畫質時注意磁碟與頻寬。
- 通常需要可用的代理網路。

祝你使用愉快～
