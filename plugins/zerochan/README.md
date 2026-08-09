# Zerochan 动漫图板 - 插件说明

本插件用于从 `zerochan.net` 爬取动漫图片并加入下载队列。站点是**纯服务端渲染**的，
列表和详情全在首屏 HTML 里，所以插件走的是轻量的 `fetch` + DOM 解析，不需要开 WebView。

Zerochan 的特点是**人工整理的标签体系**：每张图的标签都分了类（画师 / 作品 / 角色 / 主题 / 来源），
还标了是谁加的，以及原作发布在哪（Pixiv、Twitter、DeviantArt……）。这些都会写进图片元数据，
在图片详情侧栏按站点原样的配色还原出来。

## 爬取模式

- **浏览全部（all）**：不带标签逛全站 `/?s=…&p=N`
- **标签（tag）**：按单个站内标签 `/<Tag+Name>?s=…&p=N`
- **搜索（search）**：任意关键词 `/search?q=…`；站点会跳到最匹配的标签页，并用剩余词继续过滤
  （例如 `blue hair smile` 会落到 `Blue Hair` 标签并叠加其余条件）

三种模式都可以选**排序**：

- **最新（id）**：按上传时间倒序
- **人气（fav）**：按收藏数倒序

## 配置项

- **爬取模式（crawl_mode）**：浏览全部 / 标签 / 搜索
- **标签（tag）**：站内标签的规范名（英文），例如 `Arknights`、`Hatsune Miku`、`Genshin Impact`
- **搜索词（search_query）**：任意关键词
- **排序（sort_order）**：最新 / 人气
- **起始页面 / 结束页数（start_page / end_page）**：每页 48 条，一次最多 100 页
- **质量（quality）**：
  - **高（high）**：原图直链（`static.zerochan.net/….full.….jpg`）
  - **中（medium）**：站点 1024px 的 webp 预览图

## 元数据

每张图都会带上从详情页解析的元数据，图片详情侧栏用 `description.ejs` 还原站点右侧栏：

- `tags`：每个标签的规范名 `tag`、展示名 `label`、分类 `type`、sprite 图标 `icon`、
  站内链接 `url`、添加者 `by`，以及 `fav` / `primary` 标记
- `tags_string`：规范名串，可直接用于二次检索
- `source`：原作发布页 URL 与站点图标名（pixiv / twitter / deviantart…）
- `share`：站点给的直链、BBCode 缩略图、HTML 缩略图三段分享文本
- `stats`：尺寸、百万像素、收藏数、标签数
- `post_id`、`title`、`permalink`、`breadcrumbs`、`mangaka`、`uploader`、`uploaded_at`
- `file_size`、`file_ext`、`width`、`height`、`full_url`、`sample_url`

侧栏模板的四个区块（标签 / 来源 URL / 分享 / 状态）**标题与文案随应用语言切换**
（简中 / 繁中 / 英文 / 日文 / 韩文），标签配色与图标直接沿用站点自身的样式表，浅色深色都跟随应用主题。
分享区的三段文本都带一键复制。

## 注意事项

- **站点有一道 bot 校验**：首次请求会返回 503「Checking browser...」，插件会自动完成校验取到
  `xbotcheck` cookie 后重试，正常情况下不需要人工干预。
- **匿名访问看不全**：列表页尾部会写 "Some images on this page are for members only"，
  所以每页实际拿到的条目通常少于 48 条。要看全需要在「畅游」里登录站点。
- **标签名要用站内规范名**：填的是站内标签而不是自由文本；拿不准就用**搜索**模式，让站点自己去匹配。
- **请文明爬取**：一次最多 100 页，超过会拒绝执行；结束页面必须 ≥ 起始页面。每张图之间有节流。
- 通常需要可用的代理网络。

楽しんで～
