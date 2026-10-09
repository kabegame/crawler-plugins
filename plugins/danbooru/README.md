# Danbooru 二次元图库 - 插件说明

本插件用于从 Danbooru（默认全年龄站 `donmai.moe`）爬取二次元作品并加入下载队列，**并把详情页的全量标签写进图片元数据**——
标签会按分类写入应用的「标签」分区（`danbooru/<分类>`），可在画册页浏览、在搜索里按标签筛选。

## 爬取模式

- **标签（tags）**：按标签组合检索 `/posts?tags=...`，最常用
- **人气榜（popular）**：日/周/月人气榜 `/explore/posts/popular`
- **全部（all）**：全站最新作品 `/posts`
- **id 范围（id_range）**：按作品 id 区间检索 `/posts?tags=id:A..B order:id -status:deleted`，按 id 从小到大抓完整个区间

## 配置项

- **源站（source_site）**：`donmai.moe`（默认，仅全年龄内容）或 `danbooru.donmai.us`（全站）
- **标签组合（mode_tag_value）**：列表输入，运行时用空格连接；标签里的空格自动转下划线 `_`
- **人气榜周期（popular_scale）**：日榜 / 周榜 / 月榜
- **起始页面 / 结束页数（start_page / end_page）**：一次最多 100 页
- **每页条数（per_page）**：20 / 50 / 100 / 200，越大越省翻页
- **分级过滤（rating）**：不限 / 全年龄(General) / 敏感(Sensitive) / 存疑(Questionable) / 限制级(Explicit)，只在源站选全站时显示。全部和标签模式把 `rating:g` 这样的元标签拼进搜索串，它**不占**「最多 2 个标签」的名额；人气榜模式由插件按每张图的分级筛选
- **起始 id / 结束 id（id_start / id_end）**：id 范围模式用，作品 id 闭区间（作品页地址 `/posts/<id>` 里的数字），**最多相差 5000**，否则拒绝爬取。不用填页数，已删除的作品在搜索端就排除了；`id:`、`order:`、`status:` 元标签都不占「最多 2 个标签」的名额。每页条数和分级过滤同样适用；源站为 `donmai.moe` 时固定只取全年龄
- **质量（quality）**：
  - **高（high）**：原图直链（站点上有几十 MB 的超大图，注意磁盘和带宽）
  - **中（medium）**：站点缩放后的 sample；视频帖没有 sample，会自动回落到原文件

## 元数据

每张图都会带上从详情页解析的元数据，图片详情侧栏用 `description.ejs` 渲染：

- `tags_string`：**全量标签串**，按 作家 → 版权 → 角色 → 通用 → 元信息 排好序
- `tags`：每个标签的 `name` / `display` / `type` / `count` / 站内检索链接 / wiki 链接
- `tags_by_type`：按分类分好组的标签名数组
- `post_id`、`rating`、`score`、`fav_count`、`status`
- `file_size`、`file_ext`、`width`、`height`、`original_href`、`sample_href`
- `uploader_name` / `uploader_href`、`posted_date_iso`、`source_href`
- `commentary`：画师原始评论的标题与正文

同时插件注册了 PathQL provider，画廊里可以按 **分数（score）/ 收藏数（favorites）/ 分级（rating）** 筛选已下载的图，分级按 General / Sensitive / Questionable / Explicit 分组；分数和收藏数列表给出 `5+`、`10+` … `1000+` 等「不低于某值」的档位；路径段也接受区间写法 `100-500`、`100+`、`-50`（两端都包含）。

## 注意事项

- **站点对未登录 / 普通账号限制每次检索最多 2 个标签**。填第 3 个标签时插件会 WARN，站点大概率返回空结果。
  要多标签检索需要在「畅游」里登录并升级账号等级。
- **请文明爬取**：一次最多 100 页，超过会拒绝执行；结束页面必须 ≥ 起始页面。
- 默认源站 `donmai.moe` 只提供全年龄内容（搜 `rating:e` 也不会返回结果）；`danbooru.donmai.us` 含成人内容，未登录时按站点默认规则过滤。
- 通常需要可用的代理网络。
- 默认源站 `donmai.moe` 有 Cloudflare 验证（全站 `danbooru.donmai.us` 不需要）：首次使用（或验证过期后）请先在「畅游」中打开 `donmai.moe` 并通过验证，插件会沿用畅游的 Cookie 与浏览器标识；被拦截时任务会直接报错提示。
- 站上有 mp4 / webm 视频帖，插件会按原文件直链下载。

楽しんで～
