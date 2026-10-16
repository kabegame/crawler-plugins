# AIBooru AI 图库

[AIBooru](https://aibooru.online) 是基于 Danbooru 的 AI 生成图图库，每张图都有社区整理的标签，很多还附带生成参数（prompt、负面词、采样器、种子、模型）。本插件通过站点的公开 JSON 接口抓取，不需要登录。

## 爬取模式

- **全部**：按上传时间从新到旧翻页。
- **标签**：按标签组合检索。站点限制每次最多 4 个标签，`order:` 也算一个；`rating:`、`status:`、`id:` 不计入。
- **人气榜**：日榜、周榜或月榜。站点按美东时间计日，刚过零点时当天日榜为空，插件会自动改抓前一天。
- **id 范围**：按作品 id 从小到大抓取一个区间，起止最多相差 5000。

## 分级

站点里 R-18 内容占比很高，人气榜里通常过半，所以「分级过滤」默认只抓**全年龄（General）**。人气榜接口不支持按分级检索，只能在插件里逐张筛选，因此一页 100 条里符合条件的可能只有几张。

## 质量

- **高**：原图。PNG 原图里通常还保留着完整的生成参数。
- **中**：站点缩放后的 sample（JPEG / WebP），体积小得多。

## 元数据

在应用里预览图片时，「插件详情」面板会按 AIBooru 详情页的版式显示：分组标签及帖数、Information、Original Commentary、AI Metadata 和评论。这些内容都是下载时的快照，不会随站点更新。

标签会按分类写入标签画册 `aibooru/artist`、`aibooru/model`、`aibooru/copyright`、`aibooru/character`、`aibooru/general` 和 `aibooru/meta`。prompt、负面词、模型名等也能被「元数据」范围的搜索搜到。
