# Crawler Plugins

这是一个包含各种爬虫插件的仓库，用于 Kabegame 图片收集系统。

## 插件列表

### 1. anihonet-wallpaper

**名称**: anihonet动漫壁纸  
**版本**: 1.0.0  
**描述**: anihonet动漫壁纸收集源插件  
**作者**: Kabegame

**路径**: `anihonet-wallpaper/`

**文件结构**:
```
anihonet-wallpaper/
├── manifest.json    # 插件元数据
├── config.json      # 插件配置
├── crawl.rhai       # 爬虫脚本
├── icon.ico         # 插件图标
├── doc_root/        # 文档目录
│   ├── doc.md       # 用户文档
│   └── 1 (64).jpeg  # 示例图片
└── README.md        # 开发文档
```

**引用方式**:
```bash
npm run package-plugin crawler_plugins/anihonet-wallpaper
```

---

### 2. local-folder-import

**名称**: 本地文件夹导入  
**版本**: 1.0.0  
**描述**: 从本地文件夹导入图片文件到图库  
**作者**: Kabegame

**路径**: `local-folder-import/`

**功能**:
- 扫描指定文件夹内的图片文件（非递归）
- 支持配置文件扩展名列表
- 自动复制文件到图库目录
- 如果源文件和目标文件相同，自动跳过

**配置变量**:
- `folder_path` (path 类型): 要导入的本地文件夹路径
- `file_extensions` (list 类型): 要导入的文件扩展名列表，默认为 ["jpg", "jpeg", "png", "gif", "webp", "bmp"]

**文件结构**:
```
local-folder-import/
├── manifest.json    # 插件元数据
├── config.json      # 插件配置
├── crawl.rhai       # 爬虫脚本
├── doc_root/        # 文档目录
│   └── doc.md       # 用户文档
└── README.md        # 开发文档
```

**引用方式**:
```bash
npm run package-plugin crawler_plugins/local-folder-import
```

---

### 3. single-file-import

**名称**: 单文件导入  
**版本**: 1.0.0  
**描述**: 从本地选择单个图片文件导入到图库（仅入队一次）  
**作者**: Kabegame

**路径**: `single-file-import/`

**功能**:
- 从本地选择单个图片文件导入到图库
- 脚本只入队一次，避免重复导入

**文件结构**:
```
single-file-import/
├── manifest.json    # 插件元数据
├── config.json      # 插件配置
├── crawl.rhai       # 爬虫脚本
├── doc_root/        # 文档目录
│   └── doc.md       # 用户文档
└── README.md        # 开发文档
```

**引用方式**:
```bash
npm run package-plugin crawler_plugins/single-file-import
```

---

## 使用方法

### 作为 Git Submodule

这个仓库作为主项目的 Git Submodule 使用：

```bash
# 初始化 submodule（首次克隆主项目时）
git submodule update --init --recursive

# 更新 submodule 到最新版本
git submodule update --remote crawler_plugins

# 更新所有 submodules
git submodule update --remote
```

### 打包插件

在主项目根目录执行：

```bash
npm run package-plugin crawler_plugins/<插件名称>
```

打包后的文件将生成在 `test_plugin_packed/<插件名称>.kgpg`

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

