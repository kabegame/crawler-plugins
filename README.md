# Crawler Plugins

这是一个包含各种爬虫插件的仓库，用于 Kabegame 图片收集系统。

## 插件列表

### 1. anihonet-wallpaper

**名称**: anihonet动漫壁纸  
**版本**: 1.0.0  
**描述**: anihonet动漫壁纸收集源插件  
**作者**: Kabegame

**路径**: `plugins/anihonet-wallpaper/`  
**详细文档**: [plugins/anihonet-wallpaper/README.md](plugins/anihonet-wallpaper/README.md)

**文件结构**:
```
anihonet-wallpaper/
├── manifest.json    # 插件元数据
├── config.json      # 插件配置
├── crawl.rhai       # 爬虫脚本
├── icon.png         # 插件图标（仅支持 PNG）
├── doc_root/        # 文档目录
│   ├── doc.md       # 用户文档
│   └── 1 (64).jpeg  # 示例图片
└── README.md        # 开发文档
```

**引用方式**:
```bash
pnpm run package-plugin crawler-plugins/plugins/anihonet-wallpaper
```

---

### 2. local-import

**名称**: 本地导入  
**版本**: 1.0.0  
**描述**: 导入本地图片：支持拖入单个图片文件或整个文件夹（可选递归）  
**作者**: Kabegame

**路径**: `plugins/local-import/`  
**详细文档**: [plugins/local-import/README.md](plugins/local-import/README.md)

**功能**:
- 导入单文件：一次 `download_image(file_path)`
- 导入文件夹：扫描文件夹（可选递归）后逐个 `download_image`

**配置变量**（二选一）:
- `file_path`：图片文件路径（优先）
- `folder_path`：文件夹路径
- `recursive`：是否递归扫描子文件夹（仅文件夹导入生效）
- `file_extensions`：扩展名列表（仅文件夹导入生效）

**文件结构**:
```
local-import/
├── manifest.json    # 插件元数据
├── config.json      # 插件配置
├── crawl.rhai       # 脚本
├── doc_root/        # 文档目录
│   └── doc.md       # 用户文档
└── README.md        # 开发文档
```

**引用方式**:
```powershell
pnpm run package-plugin crawler-plugins/plugins/local-import
```

---

## 使用方法

### 作为 Git Submodule

这个仓库作为主项目的 Git Submodule 使用：

```bash
# 初始化 submodule（首次克隆主项目时）
git submodule update --init --recursive

# 更新 submodule 到最新版本
git submodule update --remote crawler-plugins

# 更新所有 submodules
git submodule update --remote
```

### 打包插件

#### 在插件仓库中打包

本仓库提供了打包工具，可以将插件打包为 `.kgpg` 格式（ZIP 压缩格式）。

**安装依赖**（首次使用）：

```bash
pnpm install
```

**打包所有插件**：

```bash
pnpm run package
# 或
node package-plugin.js
```

**指定输出目录（可选）**：

默认输出到 `crawler-plugins/packed/`。如果你希望把 `.kgpg` 直接输出到其它目录（例如主仓库开发模式的 `data/plugins-directory/`），可以使用 `--outDir`：

```bash
# 输出到 <repo>/data/plugins-directory
node package-plugin.js --outDir ../data/plugins-directory
```

**打包单个插件**：

```bash
node package-plugin.js <插件名称>
# 例如：
node package-plugin.js anihonet-wallpaper
```

**打包单个插件并指定输出目录（可选）**：

```bash
node package-plugin.js anihonet-wallpaper --outDir ../data/plugins-directory
```

**仅打包指定插件（多选，用于开发提速）**：

```bash
# 只打包这两个插件，并清理 packed 目录下其它 .kgpg（避免开发模式下被应用加载到）
node package-plugin.js --only single-file-import local-folder-import

# 也支持逗号分隔
node package-plugin.js --only single-file-import,local-folder-import
```

**仅打包指定插件并指定输出目录（可选）**：

```bash
node package-plugin.js --only single-file-import local-folder-import --outDir ../data/plugins-directory
```

打包后的文件将生成在 `packed/<插件名称>.kgpg` 目录中。

**生成插件索引文件（index.json）**：

索引文件用于 GitHub Release，包含所有插件的下载链接和元数据。版本信息自动从 `package.json` 读取。

```bash
# 生成索引文件（版本从 package.json 读取）
pnpm run generate-index

# 手动指定仓库信息（可选）
node generate-index.js kabegame crawler-plugins
```

生成的 `index.json` 将保存在 `packed/index.json`，格式符合后端期望：
- 版本信息从 `package.json` 的 `version` 字段读取，自动添加 `v` 前缀（如 `1.0.0` → `v1.0.0`）
- 使用 camelCase 字段名（`downloadUrl`, `sizeBytes`）
- 包含 SHA256 校验和
- 下载 URL 指向 GitHub Release：`https://github.com/kabegame/crawler-plugins/releases/download/{tag}/{plugin}.kgpg`
- 图标：KGPG v2 已将列表图标写入 `.kgpg` 固定头部，可通过 HTTP Range 直接读取；`index.json` 不再需要 `iconUrl`，也不再生成 `packed/<plugin>.icon.png`

**一键打包并生成索引**：

```bash
pnpm run release
```

这将先打包所有插件，然后生成索引文件。

**发布新版本**：

1. 更新 `package.json` 中的 `version` 字段（如 `1.0.0` → `1.1.0`）
2. 提交更改并推送到 `main` 分支
3. GitHub Actions 会自动：
   - 从 `package.json` 读取版本号
   - 创建 tag（格式：`v{version}`，如 `v1.1.0`）
   - 打包所有插件
   - 生成 `index.json`
   - 创建 GitHub Release 并上传文件

如果 tag 已存在，workflow 会跳过发布以避免重复。

**Git Hooks（自动打 tag）**：

本仓库配置了 `pre-push` git hook，在 `git push` 前会自动尝试根据 `package.json` 的版本创建 tag（格式：`v{version}`）。如果 tag 已存在则跳过，不会阻断 push。

首次使用需要启用 hooks：

```bash
# 安装依赖（会自动运行 prepare 脚本安装 husky）
pnpm install
# 或手动运行
pnpm prepare
```

之后每次 `git push` 时，hook 会自动尝试创建对应的 tag（如果不存在）。

#### 在主项目中使用

在主项目根目录执行：

```bash
pnpm run package-plugin crawler-plugins/plugins/<插件名称>
```

打包后的文件将生成在 `crawler-plugins/packed/<插件名称>.kgpg`

---

## 开发文档

### 插件开发指南

详细的插件开发指南，包括：
- 插件目录结构
- 打包插件的方法
- 插件文件格式说明（manifest.json、config.json、crawl.rhai）
- 变量类型和配置说明

📖 [README_PLUGIN_DEV.md](README_PLUGIN_DEV.md)

### Rhai API 文档

完整的 Rhai 爬虫 API 参考文档，包括：
- 页面导航函数（`to()`, `back()`, `to_json()`）
- 页面信息函数（`current_url()`, `current_html()`）
- 元素查询函数（`query()`, `get_attr()`, `query_by_text()`）
- URL 处理函数（`resolve_url()`, `is_image_url()`）
- 图片处理函数（`download_image()`）
- 完整示例和注意事项

📖 [RHAI_API.md](RHAI_API.md)

---

## 仓库信息

**远程仓库**: git@github.com:kabegame/crawler-plugins.git  
**主分支**: main

---

## 贡献

欢迎提交新的插件或改进现有插件。请确保：

1. 遵循插件的标准文件结构
2. 提供完整的 manifest.json 配置
3. 编写清晰的 README.md 文档
4. 包含用户文档（doc_root/doc.md）

开发新插件前，请先阅读 [插件开发指南](README_PLUGIN_DEV.md) 和 [Rhai API 文档](RHAI_API.md)。

