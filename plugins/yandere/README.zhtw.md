# yande.re 動漫桌布 - 插件說明

本插件用於從 `yande.re` 爬取高解析度動漫桌布並加入下載佇列。站台跑的是 Moebooru
（和 konachan 同一套程式），因此列表頁 / 詳情頁 / 標籤表的結構與 konachan 插件同構。

## 爬取模式

- **全部（all）**：全站最新作品（`/post?page=N`）
- **標籤（tags）**：依標籤組合檢索（`/post?tags=a+b&page=N`）
- **標籤列表（tag_list）**：先依匹配式瀏覽標籤表（`/tag?name=...`），再逐個標籤抓它的作品

## 設定項

- **標籤組合（mode_tag_value）**：列表輸入，執行時用 `+` 連接；標籤裡的空格自動轉底線 `_`
- **分級過濾（rating）**：不限 / 全年齡(Safe) / 存疑(Questionable) / 限制級(Explicit)。
  實作上是把 `rating:safe` 這樣的元標籤拼進搜尋串
- **排序（sort_order）**：最新發布 / 高分優先 / 解析度優先 / 隨機，對應站台的 `order:` 元標籤
- **起始頁面 / 結束頁數（start_page / end_page）**：一次最多 100 頁，**每頁固定 40 張**
- **標籤匹配式（tag）**：標籤列表模式下的名稱匹配，`*` 是萬用字元，如 `*genshin*`
- **標籤類型（mode_tag_type）**：任意 / 通用 / 作家 / 版權 / 角色 / 圈子 / 瑕疵
- **標籤排序（mode_tag_order）**：圖片數量 / 名稱 / 日期
- **跳過標籤數量 / 爬取標籤數量 / 每個標籤頁數**：控制標籤列表模式的廣度與深度
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

插件同時註冊了 PathQL provider，圖庫裡可以依 **標籤類型 → 標籤** 兩級瀏覽已下載的圖。

## 注意事項

- **標籤類型參數只認數字**。站台的 `/tag?type=` 接受 `0`(general) / `1`(artist) /
  `3`(copyright) / `4`(character) / `5`(circle) / `6`(faults)；傳英文名不會報錯，
  會被當成 `0` 靜默降級成「通用」，所以設定項裡的值就是這些數字。
- **每頁 40 張是站台寫死的**，未登入時 URL 上沒有可用的每頁筆數參數。
- **收藏者與留言會被截斷**（24 人 / 30 則）。熱門帖的收藏者可以有上千人，
  中繼資料整筆進庫並參與畫冊列表查詢，不截斷會明顯拖慢畫冊。
- **請文明爬取**：一次最多 100 頁，超過會拒絕執行；結束頁面必須 ≥ 起始頁面。
- 站內成人內容與全年齡內容混排，只想要乾淨圖請把「分級過濾」選成全年齡(Safe)。
- 這個站的原圖動輒七八千像素、數十 MB，用「高」畫質時注意磁碟與頻寬。
- 通常需要可用的代理網路。

祝你使用愉快～
