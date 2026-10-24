# hydrus 下载器

运行 [hydrus network](https://hydrusnetwork.github.io/hydrus/) 的 downloader png，或把现有 hydrus 数据库里的文件导入 Kabegame。

## 用法

插件有一份自己的**下载器库**，相当于 hydrus 里 `network > downloaders` 下的全部设置（GUG、URL class、解析器、按域名的请求头与带宽规则）。下载器 png 导入进库后一直保留，之后的任务都能用。三种模式：

### 导入 png 并搜索

1. 准备一张 hydrus downloader png。可以从 hydrus 的 `network > downloaders > export downloaders` 导出，也可以从社区仓库 [CuddleBear92/Hydrus-Presets-and-Scripts](https://github.com/CuddleBear92/Hydrus-Presets-and-Scripts/tree/master/Downloaders) 下载。
2. 在「下载器 png」里选择这张图，在「搜索」里填写搜索内容。多个词用空格分隔，与 hydrus 相同。「搜索」留空时只导入 png。
3. png 里有多个搜索入口（GUG）时，在「搜索入口（GUG）」填写名称。这里可以填库里任何一个 GUG 或嵌套 GUG（NGUG），已经导入过的下载器不用再选 png。填错时，任务日志会列出可选的名称。
4. 有的下载器在 URL class 里放了占位的参数默认值（例如 wallhaven 的 `apikey=myPersonalApiToken`），在 hydrus 里需要编辑 URL class 才能用。这里在「URL 参数默认值」里填 `参数名=值` 覆盖，值留空（如 `apikey=`）表示不再补这个参数。

导入规则与 hydrus 的「导入下载器」相同：

- 和库里完全相同的对象会跳过。
- 重名的对象会加上 ` (1)` 后缀。
- 新 URL class 和库里已有的 URL class 能互相认出对方的示例地址时，已有的那个改名为 `zzz - renamed due to auto-import - …` 保留。新导入的接手这类地址。
- URL class 与解析器的关联按 hydrus 的自动关联规则重算。

NGUG 会展开成它引用的各个 GUG 依次搜索。「最多列表页数」对每个 GUG、每个子列表页分别计算，只有翻下一页才累计；「最多文件数」共用。

### 输入网址

直接给帖子、列表页或文件地址，用库里的下载器处理，不导入 png。规则与 hydrus 的网址导入相同：

- 帖子地址抓详情页解析。
- 文件地址和库里认不出的地址直接下载。
- 列表页和 thread 只抓这一页，不翻下一页。

### 导入 hydrus 数据库

把已有 hydrus 里的文件导入 Kabegame（仅桌面端）。在「hydrus db 目录」选择 hydrus 的 db 目录（里面有 `client.db`，一般在安装目录的 `db` 下，或 macOS 的 `~/Library/Hydrus`）。插件只读，不会改动 hydrus 的数据。建议先关闭 hydrus；hydrus 正在写入时，插件会重读，直到读到一致的数据。

- **导入文件**：导入「所有我的文件」里的图片和视频，可选连同回收站。
  - 本地标签服务（my tags、downloader tags 等）的标签按 namespace 挂到 `hydrus/<namespace>` 标签画册。标签仓库（PTR）不导入。
  - 网址、备注、来源时间、导入时间、修改时间、归档时间等存进 metadata。
  - 已有的文件按内容去重。
- **合并下载器**：把 hydrus 里配置好的下载器加入插件的下载器库，相当于一次批量导入，规则与导入 png 相同，库里已有的不会被覆盖。
  - 只复制已批准的按域名请求头。
  - `Cookie`、`Authorization` 等凭据类请求头不复制。
- hydrus 把文件放在 db 目录以外时（在 hydrus 里移动过文件存储位置），还要在「文件目录」选择那个目录（里面是 `f00`、`f01` 等文件夹）。任务日志会提示实际位置。

旧版本 hydrus 导出的 png 会先按 hydrus 自己的规则升级到当前格式，再运行。

下载流程与 hydrus 的 gallery 下载相同：GUG 生成第一页 → 列表页解析出文件地址、子列表页和下一页 → 帖子地址再抓详情页解析，只解析出一个文件地址就下载，解析出多个地址就逐个展开继续处理。URL class 设置了 API 地址转换时，请求的是转换后的地址，用 API 对应的解析器解析。列表页、详情页解析出的标签、来源地址、备注、md5、发布时间会沿着这条链一路继承，存进 metadata。

请求方式与 hydrus 相同：默认使用 hydrus 的 User-Agent（`Mozilla/5.0 (compatible; Hydrus Client)`）、`Accept` 与 `Cache-Control`，叠加 png 里按域名设置的请求头和 URL class 的请求头覆盖，并按 URL class 的规则发送 Referer。请求频率也沿用 hydrus 的默认带宽规则：每个域名每秒 1 个请求、全局每秒 5 个请求；png 里带了域名带宽规则时以它为准。

支持的解析能力：HTML、JSON、COMPOUND（Zipper）、Context Variable、Nested、Static 六种解析公式，子页面解析器，字符串拆分、切片与排序，以及按格式串（`strptime`）和自动识别两种日期转换。

已验证：wallhaven.cc（2020 HTML 版、2023 API 版）、danbooru.donmai.us、zerochan.net 的下载器 png 可以直接运行；derpibooru、imgchest、4chan thread、gelbooru 的解析结果与 hydrus 本体逐项一致；hydrus 默认下载器全集里的 gelbooru 搜索可以直接运行。

## 当前限制

- 不支持帖子监视（watcher，thread 只抓一次）、订阅、登录脚本。
- 带宽规则只执行按请求数的部分，按数据量的部分（如每天 8 GB）暂不执行。合并 hydrus 数据库时不复制带宽规则。
- 字符串处理暂不支持拼接、标签过滤（拆分、切片、排序已支持；拆分分隔符里的 `\N{名称}` 转义除外）；自动识别日期只认 ISO 8601、RFC 2822 等标准格式（hydrus 用 dateparser，能认的写法更多）。
- 格式串日期按英文区域解析；`%Z` 只认 UTC、GMT。
- 导入 hydrus 数据库只支持 v4xx 起的数据库（下载器设置第 7 版），不导入评分、重复关系和标签的兄弟 / 父子关系。

遇到不支持的内容时，任务会报出具体的对象名称。

## 测试

`test/` 下的对照测试以 hydrus 本体（v690）的输出为答案：

- 升级链：`*.upgraded.json`
- 页面解析：`pages/*.expected.json`
- 请求地址与解析器关联：`routes-*.expected.json`
- 依次导入一组 png 后的下载器库：`import-sequence.expected.json`
- 日期转换：`dates.expected.json`
- 字符串拆分、切片与排序：`steps.expected.json`

SQLite 读取器的测试用 Python 自带的 sqlite3 现场建库作对照。生成脚本都在 `test/fixtures/`。日期按本机时区解释时结果随时区变化，测试需要在 UTC 下运行：

```bash
TZ=UTC deno test -A test/
```
