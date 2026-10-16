# yande.re 动漫壁纸 - 插件说明

本插件用于从 `yande.re` 爬取高分辨率动漫壁纸并加入下载队列。站点跑的是 Moebooru
（和 konachan 同一套程序），所以列表页 / 详情页的结构与 konachan 插件同构。

## 爬取模式

- **全部（all）**：全站最新作品（`/post?page=N`）
- **标签（tags）**：按标签组合检索（`/post?tags=a+b&page=N`）
- **排行榜（popular）**：站点的人气榜。日榜 / 周榜 / 月榜（`/post/popular_by_day|week|month`）可以按日期看往期；最近 24 小时 / 一周 / 一个月 / 一年（`/post/popular_recent`）是滚动窗口，只有当期。每期只有一页、最多 40 张
- **id 范围（id_range）**：按作品 id 区间检索（`/post?tags=id:A..B+order:id&page=N`），按 id 从小到大抓完整个区间

## 配置项

- **标签组合（mode_tag_value）**：列表输入，运行时用 `+` 连接；标签里的空格自动转下划线 `_`
- **分级过滤（rating）**：不限 / 全年龄(Safe) / 存疑(Questionable) / 限制级(Explicit)。
  全部和标签模式把 `rating:safe` 这样的元标签拼进搜索串，排行榜模式由插件按每张图的分级筛选
- **排序（sort_order）**：最新发布 / 高分优先 / 分辨率优先 / 随机，对应站点的 `order:` 元标签
- **起始页面 / 结束页数（start_page / end_page）**：一次最多 100 页，**每页固定 40 张**
- **排行榜类型 / 排行榜日期 / 回溯期数（popular_scale / popular_date / popular_periods）**：排行榜模式用。日期留空为当期，回溯期数是从该日期起往前连抓多少期，一次最多 100 期
- **起始 id / 结束 id（id_start / id_end）**：id 范围模式用，作品 id 闭区间（作品页地址 `/post/show/<id>` 里的数字），**最多相差 5000**，否则拒绝爬取。不用填页数；区间里的空号不占名额，站点保留在列表里的已删除作品取不到图，会记一条警告后跳过
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

下载时侧栏标签会按类型写入应用的「标签」分区（`yandere/artist`、`yandere/character` 等），可在画册页浏览、在搜索里按标签筛选。

画廊的插件扩展里可以按 **分数**（`5+` … `1000+` 档位，路径段也支持 `100-500`、`100+`、`-50` 这样的区间）和 **分级**（Safe / Questionable / Explicit）筛选已下载的图。

## 注意事项

- **每页 40 张是站点写死的**，未登录时 URL 上没有可用的每页条数参数。
- **收藏者和评论会被截断**（24 人 / 30 条）。热门帖的收藏者可以有上千人，
  元数据整条进库并参与画册列表查询，不截断会明显拖慢画册。
- **请文明爬取**：一次最多 100 页，超过会拒绝执行；结束页面必须 ≥ 起始页面。
- 站内成人内容与全年龄内容混排，只想要干净图请把「分级过滤」选成全年龄(Safe)。
- 这个站的原图动辄七八千像素、几十 MB，用「高」质量时注意磁盘和带宽。
- 通常需要可用的代理网络。

祝你使用愉快～
