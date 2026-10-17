# anime-pictures 更新日志

## 0.7.0

- 任务日志与参数校验错误会跟随 Kabegame 的界面语言显示，支持简体中文、English、日本語、한국어与繁體中文。
- 新增「每页大小」配置，可在站点支持的 1～100 范围内调整单页图片数，默认 80。
- 新增「排序方法」配置，支持日期正序 / 倒序、评分、浏览数、文件大小、标签数和收藏日期，默认按日期排序（`date`）。
- 列表与详情改走站点 JSON API（`api.anime-pictures.net/api/v3`），原图改从 `oimages.anime-pictures.net` 直接下载。站点的 HTML 列表页与详情页受 Cloudflare 挑战，API 与原图不受，因此**不再需要先在畅游里打开 anime-pictures 通过验证**，也不再读取畅游 Cookie。
- 图片元数据结构不变（schema 1）：作者、上传 / 发布日期、尺寸与比例、文件大小与下载数、主色、标签分组与计数都由 API 字段生成，文案与分组名和以前一致；新增来源链接一项。历史图片无需迁移。
- 修复站点改版后部分新图的作者与详情信息为空。
- 需要应用 4.5.2 及以上：旧版应用发出的请求会被 Cloudflare 拦截。

## 0.6.3

- 适配插件变量空值语义，标签留空后按 `null` 处理并继续抓取全站列表。

## 0.6.2

- 新下载与历史元数据搜索索引改用详情面板的可见语义：`anime-picture`、`anime`、`picture`、标签分组、`votes` 和所有标签名称；不再索引 JSON 键名、链接、标签计数与标注者。

## 0.6.1

- 画廊细分结果的倒序与分页改用 Kabegame 4.5.1 提供的 `_kb_desc` / `_kb_x<N>x/<page>` 全局解析，移除插件内重复且已失效的分页尾定义。

## 0.6.0

- 配合应用 4.5.1 调整「细分筛选」的内部写法：不再依赖应用投影的 `plugin_metadata` 列，细分条件可以用在高级查询的「或 / 非」组合里。需要应用 4.5.1 及以上。

## 0.5.0

- 下载时把作品、角色、画师、参考、物体标签写入应用的「标签」分区（`anime-pictures/copyright`、`anime-pictures/character`、`anime-pictures/artist`、`anime-pictures/reference`、`anime-pictures/object`），可在画册页浏览、在搜索里按标签筛选。
- 标签 key 由英文标签名派生，保留空格与英文括号（如 `sua (alien stage)`），其它符号会被去掉；纯日文等无法派生 key 的标签暂不写入。
- 历史下载的图片会在元数据迁移时自动补上标签。
- 修复爬取时被 Cloudflare 拦截返回 403：`cf_clearance` 与签发它的浏览器 UA 绑定，原先写死的 Windows Chrome/124 UA
  与畅游不一致，导致验证失效。现在改用畅游的 UA（`Kabegame.cefUserAgent()`）和 Cookie（`requireCookie()`，含 HttpOnly 的 `cf_clearance`）发请求。
- 取不到畅游的 UA 或 Cookie 时回退到内置值，并在任务日志中提示；若仍然 403，请先在畅游中打开 anime-pictures 并选择接受cookie。
- 最低应用版本提升至 `4.5.0`。
- 移除插件自带的「标签分组 → 标签」浏览（已由应用级标签取代），画廊插件扩展改为按 **星数 stars**（`5+` … `1000+` 档位，路径段支持区间 `10-50`、`10+`、`-5`）与站点标注的 **主色 color**（如 `palevioletred`）筛选。
