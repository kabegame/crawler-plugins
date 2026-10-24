# Changelog

本项目的所有显著变更都会记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 【4.6.0.1】
### Added
- hydrus（0.1.0）：运行 hydrus network 的下载器，或导入现有 hydrus 数据库。插件维护一份自己的下载器库（GUG / NGUG、URL class、解析器、关联与域名请求头 / 带宽规则，存在插件 data 目录），导入规则照搬 hydrus 的「导入下载器」：相同对象跳过、重名加后缀、做同一件事的旧 URL class 改名保留、关联按自动规则重算；三种模式——**导入 png 并搜索**（png 先合并进库，可用库里任一 GUG 或 NGUG 搜索，搜索留空则只导入；NGUG 展开成子 GUG 依次搜索）、**输入网址**（按 hydrus 网址导入分流：帖子解析、文件直接下载、列表页只抓一页）、**导入 hydrus 数据库**（桌面端，`folder` 变量只读挂载 hydrus 的 db 目录，自带纯 JS 的只读 SQLite 读取器按需读页并识别 WAL，导入「所有我的文件」及可选回收站里的图片视频，本地标签服务的标签挂到 `hydrus/<namespace>` 标签画册，网址、备注、来源 / 导入 / 修改 / 归档时间存入 metadata；可选把 hydrus 里的下载器批量合并进插件的库，凭据类请求头不复制）。旧版 hydrus 导出的 png 先按 hydrus 自身的 `_UpdateSerialisableInfo` 升级链升级到 v690 格式（自带 fflate 解压，不依赖宿主）。下载流程照搬 hydrus 的 gallery 下载：GUG → 列表页 → 详情页 → 文件，支持 API 地址转换、子列表页与子页面解析器，详情页解析出多个地址时逐个展开；解析公式支持 HTML、JSON、COMPOUND、Context Variable、Nested、Static，日期转换支持格式串（`strptime`）与自动识别，字符串处理支持拆分、切片与排序。标签按 namespace 挂到 `hydrus/<namespace>` 标签画册，备注、md5、来源时间、来源地址与主地址存入 metadata。请求头与请求频率照搬 hydrus：默认 hydrus User-Agent / Accept / Cache-Control，叠加域名请求头、URL class 请求头覆盖、解析出的请求头与 Referer 规则，按请求数的默认带宽规则（每域名每秒 1 个、全局每秒 5 个）。「URL 参数默认值」用来替换或去掉 URL class 里占位的参数（如 wallhaven API 的 apikey）。已用 wallhaven（2020 HTML 版与 2023 API 版）、danbooru、zerochan 的 png 实跑，并实导一个 531 个文件的 hydrus 数据库；升级、解析、请求地址、日期转换、下载器库合并与 SQLite 读取另有与 hydrus 本体或 sqlite3 逐项比对的测试。「最多列表页数」按每个 GUG、每个子列表页分别计（「先查 ID 再进列表」的下载器在默认 1 页下也能拿到文件），URL 照 hydrus 先去首尾空白并规范化域名，GUG 名带首尾空格时也能按名字选中。已对社区仓库全部 5503 张 hydrus png 做离线导入与路由对照，并抽 134 个站点联网空跑。依赖 4.6.1 的 `file` / `folder` 类型变量。

## 【4.6.0】
### Added
- 新增 `check` 命令（`pnpm run check` / `deno task check`），使用仓库根目录的 `tsconfig.check.json` 对 `plugins/*/src` 下的 TypeScript 源码做统一类型检查（WebView 插件的 `crawl.js` 除外）。
- xhs-webview（0.1.4）：新增仿小红书详情页的插件详情模板，展示作者、正文话题、互动统计与 SSR 首屏评论；元数据补充头像、地区、话题 id 与评论快照，并挂载话题标签画册。
- pixiv 新增第三方api模式，目前支持lolicon api。
- konachan（1.7.4）：任务日志与参数校验错误新增简中、英文、日文、韩文、繁中本地化。
- 其余插件（aibooru、anihonet-wallpaper、anime-pictures、bilibili、bilibili-video、bluedafeiyu、danbooru、e-shuushuu、gelbooru、haowallpaper、heybox、kabegame-server、kemono、manyacg、miyoushe、nekos-moe、patreon-webview、pixai、pixiv、safebooru、wallhaven、wallpapers-craft、wallspic、weibo、x-webview、xhs、xhs-webview、yandere、zerochan、ziworld）：任务日志与参数校验错误同样跟随界面语言显示，支持简中、英文、日文、韩文、繁中。
- safebooru（1.0.0）：safebooru.org 全年龄图库，走站点官方 dapi，一页一次请求拿到带分类的全量标签；支持标签 / 全部 / 标签列表三种模式与评论元数据。
- aibooru（1.0.0）：aibooru.online（Danbooru 分支的 AI 生成图图库），走 JSON API 一页一次请求拿齐标签、AI 生成参数、作者评论与评论区；支持标签 / 人气榜 / 全部 / id 范围四种模式，分级默认只抓全年龄，标签新增 `model` 分类。

### Fixed
- xhs、xhs-webview（0.1.3）：小红书详情页的 `__INITIAL_STATE__` 里出现 `new Map([...])`，原先按 JSON 解析失败，每条作品都报「未解析到作品数据」；现在先展开 Map / Set 再解析。

### Changed
- kabegame-server（0.2.3）：桌面服务器媒体地址改用 `/file/{*path}`，适配不再接受 `?path=` 的 Kabegame 4.5.2 服务端。
- anime-pictures（0.7.0）：列表与详情改走站点 JSON API，原图改从 oimages 直接下载，不再需要在畅游里通过 Cloudflare 验证；新增每页大小（1～100，默认 80）与排序方法配置（默认 `date`）；元数据结构不变，并修复改版后部分新图作者与详情为空。
- 移除全部插件源码的 `// @ts-nocheck`，类型错误改由 `check` 统一暴露；存量错误已全部修完，`check` 现已通过。已下线的 twodwallpapers 保留文件级 `// @ts-nocheck`。
- aibooru：补齐站点 JSON、metadata 与配置参数类型，`check` 下该插件错误已清零；仅类型标注，无运行时行为变更。
- 其余 26 个插件（anihonet-wallpaper、anime-pictures、bilibili、bilibili-video、bluedafeiyu、danbooru、e-shuushuu、gelbooru、haowallpaper、heybox、kabegame-server、kemono、konachan、manyacg、miyoushe、nekos-moe、pixai、pixiv、safebooru、wallhaven、wallpapers-craft、wallspic、weibo、yandere、zerochan、ziworld）：补齐站点 JSON / metadata / 配置与 SDK 选项类型，`check` 下全部归零；以类型标注和等价收窄为主，正常路径运行时行为不变。twodwallpapers 用 `// @ts-nocheck` 跳过。
- **Breaking**：V8 插件 `common` 的 `base_url` 键更名为 `baseUrl`（宿主注入、`@kabegame/plugin-sdk` 的 `KbCommonCfg`、官方插件与文档同步）；第三方插件需改为 `common.baseUrl`。此前官方插件读取 `common.baseUrl` 时拿不到宿主值，自定义 `kbBaseUrl` 实际未生效，本次一并修正。WebView 同步新增 `Kabegame.vars.baseUrl`，与 V8 同名同义。
- anime-pictures、zerochan：移除传给 `downloadImage` 的 `cookie` 遗留键；下载 Cookie 一直由 `setHeader` / `requireCookie` 注入，宿主的下载选项解析也从未读取该键。
- 全部插件目录与 `package.json` 的 `name` 改为 `kabegame-plugin-<id>`（如 `plugins/kabegame-plugin-pixiv/`），应用加载时剥离前缀，插件 id、`.kgpg` 文件名与已有图片数据均不变；`engines.kabegame` 统一提到 `>=4.5.2`（旧版应用不剥离前缀，会把完整包名当成新插件）。
- `package-plugin.ts` / `generate-index.ts` / repack、run driver 按剥离后的 id 

## 【4.5.1】
### Deprecated
- twodwallpapers（0.2.5）：2dwallpapers.com 已下线（域名无 A 记录、原源站不可达），任务入口直接报错；插件保留，用于已有图片的索引与详情模板。

## 【4.5.0】

## 【4.1.0】
### Added
- Plugins:
  - kemono.cr site crawler.

## [4.0.0]
### Changed
- rhai plugins has changed to JS V8 plugins, kabegame >= 4.3.0 supports these

## [3.7.0]
### Added
- anihonet plugin add source post url
- anime-pictures plugin metadata is now stored as structured JSON with a v1 migration for historical HTML metadata.

### Fixed
- anihonet plugin resolve unstable title.

### Removed
- useless list for tag providers.

## [3.6.3]
### Fixed
- BiliBili 综合排序应为 totalrank
- Pixiv 对分页枚举应该用id排序

### Changed
- Pixiv 画师爬取改用分页

## [3.0.0]
### Added
- 新增webview后端插件
- 新增 anime-pictures 插件，可以按标签下载图片
- 新增 ziworld 插件，可以快速下载高质量壁纸

## [2.0.4] - 2026-01-22
### Changed
- **迁移到 Bun 运行时**：将所有脚本从 Node.js 迁移到 Bun，提升构建和运行性能
- **JavaScript → TypeScript 迁移**：将 `package-plugin.js` 和 `generate-index.js` 转换为 TypeScript，提供更好的类型安全和开发体验
- 添加 TypeScript 配置 (`tsconfig.json`) 和相关依赖 (`@types/node`, `typescript`)

### Added
- **Builtin 插件过滤功能**：
  - 添加 `builtin.json` 配置文件，用于定义内置插件列表
  - 修改 `generate-index.ts`，在生成插件索引时自动过滤掉 builtin 插件
  - `local-import` 插件被标记为 builtin，不再出现在发布的插件索引中

### Technical Details
- 脚本执行命令从 `node script.js` 改为 `bun run script.ts`
- 添加了完整的 TypeScript 类型定义，提高代码可维护性
- Builtin 插件机制允许核心功能插件（如本地导入）预置在应用中，而不通过插件商店分发
