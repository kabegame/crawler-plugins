# Changelog

本项目的所有显著变更都会记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 【4.5.1.4】
### Added
- 新增 `check` 命令（`pnpm run check` / `deno task check`），使用仓库根目录的 `tsconfig.check.json` 对 `plugins/*/src` 下的 TypeScript 源码做统一类型检查（WebView 插件的 `crawl.js` 除外）。
- pixiv 新增第三方api模式，目前支持lolicon api。
- konachan（1.7.4）：任务日志与参数校验错误新增简中、英文、日文、韩文、繁中本地化。
- 其余插件（aibooru、anihonet-wallpaper、anime-pictures、bilibili、bilibili-video、bluedafeiyu、danbooru、e-shuushuu、gelbooru、haowallpaper、heybox、kabegame-server、kemono、manyacg、miyoushe、nekos-moe、patreon-webview、pixai、pixiv、safebooru、wallhaven、wallpapers-craft、wallspic、weibo、x-webview、xhs、xhs-webview、yandere、zerochan、ziworld）：任务日志与参数校验错误同样跟随界面语言显示，支持简中、英文、日文、韩文、繁中。
- safebooru（1.0.0）：safebooru.org 全年龄图库，走站点官方 dapi，一页一次请求拿到带分类的全量标签；支持标签 / 全部 / 标签列表三种模式与评论元数据。
- aibooru（1.0.0）：aibooru.online（Danbooru 分支的 AI 生成图图库），走 JSON API 一页一次请求拿齐标签、AI 生成参数、作者评论与评论区；支持标签 / 人气榜 / 全部 / id 范围四种模式，分级默认只抓全年龄，标签新增 `model` 分类。

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
