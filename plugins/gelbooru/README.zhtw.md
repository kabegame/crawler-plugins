# Gelbooru 二次元圖庫 - 外掛說明

本外掛用於從 `gelbooru.com` 爬取二次元作品並加入下載佇列，**並把詳情頁的全量標籤寫進圖片中繼資料**——
標籤體系是這個站最值錢的部分，AI 生圖的 prompt 可以直接從圖片詳情側欄複製。

## 爬取模式

- **標籤（tags）**：按標籤組合檢索 `index.php?page=post&s=list&tags=...`，最常用
- **全部（all）**：全站最新作品（`tags=all`）
- **標籤列表（tag_list）**：先按匹配式瀏覽標籤表 `index.php?page=tags&s=list`，再逐個標籤抓它的作品

## 設定項

- **標籤組合（mode_tag_value）**：列表輸入，執行時用 `+` 連接；標籤裡的空格自動轉底線 `_`
- **排序（sort_order）**：最新發布 / 高分優先 / 最近更新 / 隨機。實作上是把站點的 `sort:` 元標籤
  （如 `sort:score:desc`）當成普通標籤拼進搜尋串
- **起始頁面 / 結束頁數（start_page / end_page）**：一次最多 100 頁，**每頁固定 42 張**
- **標籤匹配式（tag）**：標籤列表模式下的名稱匹配，`*` 是萬用字元，如 `*genshin*`
- **標籤類型（mode_tag_type）**：任意 / 通用 / 作家 / 版權 / 角色 / 元資訊
- **標籤排序（mode_tag_order）**：作品數量 / 名稱 / 更新日期
- **跳過標籤數量 / 爬取標籤數量 / 每個標籤頁數**：控制標籤列表模式的廣度和深度
- **畫質（quality）**：
  - **高（high）**：原圖直鏈。`absurdres` 這類標籤下 PNG 原圖常有 20~40MB，走代理時可能傳不完，
    表現為下載失敗「檔案格式不受支援（infer）」——那是沒傳完而不是解析錯了，重試或改用中畫質即可
  - **中（medium）**：站點縮放後的 sample
  - 影片貼文兩檔都取 `<video>` 裡的 **mp4** 原檔（站點同時提供 webm，但桌面相容副本本來就是 H.264 MP4）

## 中繼資料

每張圖都會帶上從詳情頁解析的中繼資料，圖片詳情側欄用 `description.ejs` 繪製：

- `tags_string`：**全量標籤串**，按 作家 → 角色 → 版權 → 元資訊 → 通用 排好序，側欄可一鍵複製
- `tags`：每個標籤的 `name` / `display` / `type` / `count` / 站內檢索連結 / wiki 連結
- `tags_by_type`：按分類分好組的標籤名陣列
- `post_id`、`rating`、`score`、`md5`、`file_ext`、`width`、`height`
- `uploader_name` / `uploader_href`、`posted_date_text`、`source_text` / `source_href`
- `original_href`、`sample_href`、`video_href`、`has_sound`、`has_children`

同時外掛註冊了 PathQL provider，圖庫裡可以按 **標籤分類 → 標籤** 兩級瀏覽已下載的圖。

## 注意事項

- **每頁 42 張是站點寫死的**。URL 上的 `limit` 參數在未登入時無效（那是帳號設定項），
  所以沒有「每頁條數」設定；翻頁用的是 `pid` 位移量而不是頁號。
- **標籤表沒有分類篩選參數**。選了「標籤類型」是把整頁取回來之後再按 `tag-type-*` 過濾的，
  分類選得越窄，湊夠「爬取標籤數量」需要翻的頁越多。
- **請文明爬取**：一次最多 100 頁，超過會拒絕執行；結束頁面必須 ≥ 起始頁面。
- 站內含成人內容，未登入狀態下站點會按預設規則過濾一部分內容。
- 通常需要可用的代理網路。
- 站上有 mp4 / webm 影片貼文，外掛會按原檔直鏈下載。

祝你使用愉快～
