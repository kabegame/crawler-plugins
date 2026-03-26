# anihonet 动漫壁纸 - 插件说明

本插件从 [anihonetwallpaper.com](https://anihonetwallpaper.com) 抓取壁纸并加入下载队列。支持 **排行榜** 与 **作品索引（アニメ・ゲーム一览）** 两种模式，默认排行榜以兼容旧配置。

## 爬取模式（crawl_mode）

| 值 | 说明 |
|----|------|
| **ranking**（默认） | 按周期爬取排行列表页，再进入每条作品的详情页下载 |
| **anime_game** | 从 [作品タイトル一覧](https://anihonetwallpaper.com/anime-game-wallpaper) 按假名行勾选，进入各「主题」列表页 → 作品详情页 → 原图链接 |

切换为「作品索引」后，会出现 **假名行（anime_game_rows）** 多选：あ / か / さ / た / な / は / ま / や / ら / わ（对应页面 `h3` 的 `id`：a, ka, sa, …）。

## 排行榜模式

1. 按 **起始页 / 结束页 / 排行榜周期** 打开排行 URL（如 `ranking-daily-imgpc/1`）。
2. 列表页会收集页面上所有 `<a>` 的 `href` 并依次进入（数量可能含导航等链接，与站点结构有关）。
3. 详情页通过 **`a.button:not(.add)`** 收集下载按钮的 `href`（排除带独立类名 `.add` 的按钮，与 `add-dl` 区分）。

**进度（100% 全任务）**：按 **列表页均分 → 页内每条链接均分 → 详情内每张图均分**；每条下载链处理完（含跳过）计一次份额。若某页 0 个 `a`，该页份额一次加完；若详情 0 个按钮，该条作品份额一次加完。

## 作品索引模式

1. 打开 `anime-game-wallpaper`，按勾选行从 HTML 中解析每个主题入口的 `<a href>`。
2. 进入 **主题作品列表页** 后，用 **`.itiran:last-of-type > a`** 的 `href` 作为进入各作品详情的链接（与浏览器 `$$('.itiran:last-of-type > a')` 一致）。
3. 详情页用 **`a.button.add-dl`** 作为原图下载按钮。

**进度（100% 全任务）**：按 **主题（每个列表入口）均分 → 主题内作品均分 → 作品内每张图均分**；跳过、过滤同样计入该图份额，避免进度卡住。

## 壁纸类型与过滤

- **壁纸类型（wallpaper_type）**：`imgpc` 只下桌面图；`sp` 只下手机图。判定依据为图片 URL **文件名**是否包含 `Android`（忽略大小写），与站点文件命名一致。
- **原图**：含 **`resize`**（大小写不敏感）的 URL 视为缩略图，**不下载**。

## 配置项摘要

| 键 | 说明 | 可见条件 |
|----|------|----------|
| **crawl_mode** | `ranking` / `anime_game` | 始终 |
| **anime_game_rows** | 假名行多选（a, ka, …, wa） | 仅 anime_game |
| **start_page / end_page** | 排行页码 1–5 | 仅 ranking |
| **ranking_period** | daily / weekly / monthly / annual | 仅 ranking |
| **wallpaper_type** | imgpc / sp | 始终 |

## 使用建议

- 只要手机壁纸：壁纸类型选「手机壁纸」。
- 只要桌面壁纸：壁纸类型选「桌面壁纸」。
- 作品索引数据量可能很大，请先勾选需要的假名行；任务日志中带 `[anihonet]` 前缀可查看当前进入的页面与下载尝试。

楽しんで～
![image](./image.jpg)
