# anihonet 动漫壁纸 - 插件说明

本插件从 [anihonetwallpaper.com](https://anihonetwallpaper.com) 抓取壁纸并加入下载队列。支持 **排行榜**、**作品索引（アニメ・ゲーム一览）** 与 **主题模式（一覧检索）**，默认排行榜以兼容旧配置。

## 爬取模式（crawl_mode）

| 值 | 说明 |
|----|------|
| **ranking**（默认） | 按周期与「排行榜子类」拼出列表路径，再进入每条作品的详情页下载 |
| **anime_game** | 从 [作品タイトル一覧](https://anihonetwallpaper.com/anime-game-wallpaper) 按假名行勾选，进入各「主题」列表页 → 作品详情页 → 原图链接 |
| **by_theme** | 在同一索引页按「主题关键字」匹配链接文案，进入第一个匹配主题，再按列表页范围抓取 |

切换为「作品索引」后，会出现 **假名行（anime_game_rows）** 多选：あ / か / さ / た / な / は / ま / や / ら / わ（对应页面 `h3` 的 `id`：a, ka, sa, …）。

## 排行榜模式

### 列表 URL（与站点路径一致）

设周期为 `ranking_period`（`daily` / `weekly` / `monthly` / `annual`），子类为 **wallpaper_type**：

| wallpaper_type | 列表路径（站点 slug） |
|----------------|----------------------|
| **all**（综合） | `ranking-{period}`，例如日榜 `ranking-daily/1` |
| **sp** | `ranking-{period}-sp`，例如 `ranking-daily-sp/1` |
| **image** | `ranking-{period}-image` |
| **imgpc** | `ranking-{period}-imgpc` |
| **pc** | `ranking-{period}-pc` |

完整 URL：`https://anihonetwallpaper.com/{slug}/{页码}`。若历史任务里仍保存旧值 `img-pc`，脚本会当作 **imgpc** 处理。

### 抓取步骤

1. 按 **起始页 / 结束页 / 排行榜周期 / 排行榜子类** 打开上表对应列表 URL。
2. 列表页收集 **`article .ranking-frame a`** 的 `href` 并依次进入详情。
3. 详情页通过 **`a.button:not(.add)`** 收集下载按钮的 `href`（排除带独立类名 `.add` 的按钮，与 `add-dl` 区分）。

**进度（100% 全任务）**：按 **列表页均分 → 页内每条链接均分 → 详情内每张图均分**；每条下载链处理完（含跳过）计一次份额。若某页 0 个 `a`，该页份额一次加完；若详情 0 个按钮，该条作品份额一次加完。

## 作品索引模式

1. 打开 `anime-game-wallpaper`，按勾选行从 HTML 中解析每个主题入口的 `<a href>`。
2. 进入 **主题作品列表页** 后，用 **`.itiran:last-of-type > a`** 的 `href` 作为进入各作品详情的链接（与浏览器 `$$('.itiran:last-of-type > a')` 一致）。
3. 详情页用 **`a.button.add-dl`** 作为原图下载按钮。

**进度（100% 全任务）**：按 **主题（每个列表入口）均分 → 主题内作品均分 → 作品内每张图均分**；跳过、过滤同样计入该图份额，避免进度卡住。

## 主题模式（by_theme）

1. 打开作品索引页，在 **div.post-list** 的链接中查找 **链接文案包含「主题关键字」** 的第一条，进入该主题列表。
2. 在 **theme_start_page**～**theme_end_page** 范围内抓取作品列表（与作品索引相同的列表 / 详情选择器）。

未匹配到关键字时，任务会跳过下载并推进进度，避免挂死。

## 下载过滤（与排行榜子类无关）

- **分类含义**：手机 / PC / 综合等由 **你选择的排行榜列表 slug** 决定，脚本 **不再** 根据图片 URL 文件名是否含 `Android` 等做手机/桌面区分。
- **缩略图**：含 **`resize`**（大小写不敏感）的 URL 视为缩略图，**不下载**。
- **扩展名**：仅当 URL 被判定为支持的图片类型时才下载（`is_image_url`）。

## 配置项摘要

| 键 | 说明 | 可见条件 |
|----|------|----------|
| **crawl_mode** | `ranking` / `anime_game` / `by_theme` | 始终 |
| **ranking_period** | daily / weekly / monthly / annual | 仅 ranking |
| **wallpaper_type** | `all` / `sp` / `image` / `imgpc` / `pc`（排行榜列表 slug） | 始终 |
| **start_page / end_page** | 排行列表页码 1–5 | 仅 ranking |
| **anime_game_rows** | 假名行多选（a, ka, …, wa） | 仅 anime_game |
| **theme_search** | 主题关键字 | 仅 by_theme |
| **theme_start_page / theme_end_page** | 主题下列表页范围 | 仅 by_theme |

## 使用建议

- 要某类排行榜：在 **排行榜子类** 中选对应项（综合、sp、image、imgpc、pc），周期与起止页按需设置。
- 作品索引数据量可能很大，请先勾选需要的假名行；主题模式请先确认关键字与站点文案一致（区分大小写）。
- 任务日志中带 `[anihonet]` 前缀可查看当前进入的页面与下载尝试。

楽しんで～
![image](./image.jpg)
