# yande.re 动漫壁纸 - 插件说明

本插件用于从 `yande.re` 爬取高分辨率动漫壁纸并加入下载队列。站点跑的是 Moebooru
（和 konachan 同一套程序），所以列表页 / 详情页 / 标签表的结构与 konachan 插件同构。

## 爬取模式

- **全部（all）**：全站最新作品（`/post?page=N`）
- **标签（tags）**：按标签组合检索（`/post?tags=a+b&page=N`）
- **标签列表（tag_list）**：先按匹配式浏览标签表（`/tag?name=...`），再逐个标签抓它的作品

## 配置项

- **标签组合（mode_tag_value）**：列表输入，运行时用 `+` 连接；标签里的空格自动转下划线 `_`
- **分级过滤（rating）**：不限 / 全年龄(Safe) / 存疑(Questionable) / 限制级(Explicit)。
  实现上是把 `rating:safe` 这样的元标签拼进搜索串
- **排序（sort_order）**：最新发布 / 高分优先 / 分辨率优先 / 随机，对应站点的 `order:` 元标签
- **起始页面 / 结束页数（start_page / end_page）**：一次最多 100 页，**每页固定 40 张**
- **标签匹配式（tag）**：标签列表模式下的名称匹配，`*` 是通配符，如 `*genshin*`
- **标签类型（mode_tag_type）**：任意 / 通用 / 作家 / 版权 / 角色 / 圈子 / 瑕疵
- **标签排序（mode_tag_order）**：图片数量 / 名称 / 日期
- **跳过标签数量 / 爬取标签数量 / 每个标签页数**：控制标签列表模式的广度和深度
- **质量（quality）**：
  - **高（high）**：Options 区「View larger version」的原文件直链，没有原文件时自动降级。
    原文件普遍 4~8MB、大图几十 MB，走代理时可能传不完，表现为下载失败
    （日志里是「end of file before message length reached」）——那是没传完而不是解析错了，
    重试或改用中质量即可
  - **中（medium）**：站点缩放后的 `#image` sample

## 元数据

每张图都会带上从详情页解析的元数据，图片详情侧栏用 `description.ejs` 渲染：

- `sidebar_tags`：侧栏标签的 `name` / `display` / `type` / `count` / 站内检索链接 / wiki 链接
- `stats`：`post_id`、`size`、`rating`、发布时间（相对文案 + `title` 里的绝对时刻）、
  收藏者列表（最多 24 人，另存总数 `favorited_total`）
- `posted_by_name` / `posted_by_href`、`source_href`、`score`
- `related`：详情页的 Related Posts（上一张 / 下一张 / 随机）
- **`comments`：详情页下方的评论区**——作者、头像、相对时间（含 `title` 上的绝对时刻）、
  正文，最多 30 条，另存总数 `comment_total`

同时插件注册了 PathQL provider，画廊里可以按 **标签类型 → 标签** 两级浏览已下载的图。

## 注意事项

- **标签类型参数只认数字**。站点的 `/tag?type=` 接受 `0`(general) / `1`(artist) /
  `3`(copyright) / `4`(character) / `5`(circle) / `6`(faults)；传英文名不会报错，
  会被当成 `0` 静默降级成「通用」，所以配置项里的值就是这些数字。
- **每页 40 张是站点写死的**，未登录时 URL 上没有可用的每页条数参数。
- **收藏者和评论会被截断**（24 人 / 30 条）。热门帖的收藏者可以有上千人，
  元数据整条进库并参与画册列表查询，不截断会明显拖慢画册。
- **请文明爬取**：一次最多 100 页，超过会拒绝执行；结束页面必须 ≥ 起始页面。
- 站内成人内容与全年龄内容混排，只想要干净图请把「分级过滤」选成全年龄(Safe)。
- 这个站的原图动辄七八千像素、几十 MB，用「高」质量时注意磁盘和带宽。
- 通常需要可用的代理网络。

祝你使用愉快～
