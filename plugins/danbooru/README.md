# Danbooru 二次元图库 - 插件说明

本插件用于从 `danbooru.donmai.us` 爬取二次元作品并加入下载队列，**并把详情页的全量标签写进图片元数据**——
标签体系是这个站最值钱的部分，AI 生图的 prompt 可以直接从图片详情侧栏复制。

## 爬取模式

- **标签（tags）**：按标签组合检索 `/posts?tags=...`，最常用
- **人气榜（popular）**：日/周/月人气榜 `/explore/posts/popular`
- **全部（all）**：全站最新作品 `/posts`
- **标签列表（tag_list）**：先按匹配式浏览标签表 `/tags`，再逐个标签抓它的作品

## 配置项

- **源站（source_site）**：`danbooru.donmai.us`（全站）或 `safebooru.donmai.us`（仅全年龄内容）
- **标签组合（mode_tag_value）**：列表输入，运行时用空格连接；标签里的空格自动转下划线 `_`
- **人气榜周期（popular_scale）**：日榜 / 周榜 / 月榜
- **起始页面 / 结束页数（start_page / end_page）**：一次最多 100 页
- **每页条数（per_page）**：20 / 50 / 100 / 200，越大越省翻页
- **标签匹配式（tag）**：标签列表模式下的名称匹配，`*` 是通配符，如 `*genshin*`
- **标签类型（mode_tag_type）**：任意 / 通用 / 作家 / 版权 / 角色 / 元信息
- **标签排序（mode_tag_order）**：作品数量 / 名称 / 日期
- **跳过标签数量 / 爬取标签数量 / 每个标签页数**：控制标签列表模式的广度和深度
- **质量（quality）**：
  - **高（high）**：原图直链（站点上有几十 MB 的超大图，注意磁盘和带宽）
  - **中（medium）**：站点缩放后的 sample；视频帖没有 sample，会自动回落到原文件

## 元数据

每张图都会带上从详情页解析的元数据，图片详情侧栏用 `description.ejs` 渲染：

- `tags_string`：**全量标签串**，按 作家 → 版权 → 角色 → 通用 → 元信息 排好序，侧栏可一键复制
- `tags`：每个标签的 `name` / `display` / `type` / `count` / 站内检索链接 / wiki 链接
- `tags_by_type`：按分类分好组的标签名数组
- `post_id`、`rating`、`score`、`fav_count`、`status`
- `file_size`、`file_ext`、`width`、`height`、`original_href`、`sample_href`
- `uploader_name` / `uploader_href`、`posted_date_iso`、`source_href`
- `commentary`：画师原始评论的标题与正文

同时插件注册了 PathQL provider，画廊里可以按 **标签分类 → 标签** 两级浏览已下载的图。

## 注意事项

- **站点对未登录 / 普通账号限制每次检索最多 2 个标签**。填第 3 个标签时插件会 WARN，站点大概率返回空结果。
  要多标签检索需要在「畅游」里登录并升级账号等级。
- **请文明爬取**：一次最多 100 页，超过会拒绝执行；结束页面必须 ≥ 起始页面。
- 站内含成人内容，`danbooru.donmai.us` 默认按未登录状态过滤；只想要全年龄可选 `safebooru.donmai.us`。
- 通常需要可用的代理网络。
- 站上有 mp4 / webm 视频帖，插件会按原文件直链下载。

楽しんで～
