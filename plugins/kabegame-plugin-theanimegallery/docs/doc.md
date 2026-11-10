# The Anime Gallery 壁纸

从 [The Anime Gallery](https://theanimegallery.com/) 抓取动漫壁纸（桌面与手机分辨率均有）。

## 模式

### 首页精选（默认）

抓取站点首页展示的精选壁纸，每次约 24 张。

### 分类

按站点分类浏览（anime、naruto、cute 等 46 个分类），一个分类最多返回 80 张壁纸。

### 搜索

按关键词搜索壁纸，例如 `miku`、`dragon ball`（多词直接用空格）。
一次搜索最多返回 80 张壁纸，没有翻页。

## 说明

- 下载的是站点提供的原图（WebP 格式）。
- 站点的搜索标签、内容标签与分类会分别挂到
  `theanimegallery/tag`、`theanimegallery/label`、`theanimegallery/category` 标签目录。
