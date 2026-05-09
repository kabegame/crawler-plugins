# Changelog

本项目的所有显著变更都会记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [3.6.4]
### Added
- anihonet plugin add source post url

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