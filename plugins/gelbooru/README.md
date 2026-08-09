# Gelbooru 二次元图库 - 插件说明

本插件用于从 `gelbooru.com` 爬取二次元作品并加入下载队列，**并把详情页的全量标签写进图片元数据**——
标签体系是这个站最值钱的部分，AI 生图的 prompt 可以直接从图片详情侧栏复制。

## 爬取模式

- **标签（tags）**：按标签组合检索 `index.php?page=post&s=list&tags=...`，最常用
- **全部（all）**：全站最新作品（`tags=all`）
- **标签列表（tag_list）**：先按匹配式浏览标签表 `index.php?page=tags&s=list`，再逐个标签抓它的作品

## 配置项

- **标签组合（mode_tag_value）**：列表输入，运行时用 `+` 连接；标签里的空格自动转下划线 `_`
- **排序（sort_order）**：最新发布 / 高分优先 / 最近更新 / 随机。实现上是把站点的 `sort:` 元标签
  （如 `sort:score:desc`）当成普通标签拼进搜索串
- **起始页面 / 结束页数（start_page / end_page）**：一次最多 100 页，**每页固定 42 张**
- **标签匹配式（tag）**：标签列表模式下的名称匹配，`*` 是通配符，如 `*genshin*`
- **标签类型（mode_tag_type）**：任意 / 通用 / 作家 / 版权 / 角色 / 元信息
- **标签排序（mode_tag_order）**：作品数量 / 名称 / 更新日期
- **跳过标签数量 / 爬取标签数量 / 每个标签页数**：控制标签列表模式的广度和深度
- **质量（quality）**：
  - **高（high）**：原图直链。`absurdres` 这类标签下 PNG 原图常有 20~40MB，走代理时可能传不完，
    表现为下载失败「文件格式不受支持（infer）」——那是没传完而不是解析错了，重试或改用中质量即可
  - **中（medium）**：站点缩放后的 sample
  - 视频帖两档都取 `<video>` 里的 **mp4** 原文件（站点同时提供 webm，但桌面兼容副本本来就是 H.264 MP4）

## 元数据

每张图都会带上从详情页解析的元数据，图片详情侧栏用 `description.ejs` 渲染：

- `tags_string`：**全量标签串**，按 作家 → 版权 → 角色 → 通用 → 元信息 排好序，侧栏可一键复制
- `tags`：每个标签的 `name` / `display` / `type` / `count` / 站内检索链接 / wiki 链接
- `tags_by_type`：按分类分好组的标签名数组
- `post_id`、`rating`、`score`、`md5`、`file_ext`、`width`、`height`
- `uploader_name` / `uploader_href`、`posted_date_text`、`source_text` / `source_href`
- `original_href`、`sample_href`、`video_href`、`has_sound`、`has_children`

同时插件注册了 PathQL provider，画廊里可以按 **标签分类 → 标签** 两级浏览已下载的图。

## 注意事项

- **每页 42 张是站点写死的**。URL 上的 `limit` 参数在未登录时无效（那是账号设置项），
  所以没有「每页条数」配置；翻页用的是 `pid` 偏移量而不是页号。
- **标签表没有分类筛选参数**。选了「标签类型」是把整页取回来之后再按 `tag-type-*` 过滤的，
  分类选得越窄，凑够「爬取标签数量」需要翻的页越多。
- **请文明爬取**：一次最多 100 页，超过会拒绝执行；结束页面必须 ≥ 起始页面。
- 站内含成人内容，未登录状态下站点会按默认规则过滤一部分内容。
- 通常需要可用的代理网络。
- 站上有 mp4 / webm 视频帖，插件会按原文件直链下载。

祝你使用愉快～
