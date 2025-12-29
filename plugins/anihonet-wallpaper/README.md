# anihonet 动漫壁纸插件

## 插件信息

- **名称**：anihonet动漫壁纸
- **版本**：1.0.0
- **作者**：Kabegame
- **描述**：anihonet动漫壁纸收集源插件

## 源站信息

本插件从以下网站抓取壁纸：

**源站地址**：[https://anihonetwallpaper.com](https://anihonetwallpaper.com)

## 配置说明

### 起始页面（start_page）

- **类型**：整数（int）
- **描述**：要拉取的起始页面
- **默认值**：1
- **取值范围**：1 - 5

### 最大页数（max_pages）

- **类型**：整数（int）
- **描述**：最多爬取多少页
- **默认值**：5
- **取值范围**：1 - 5

### 壁纸类型（wallpaper_type）

- **类型**：选项（options）
- **描述**：选择要爬取的壁纸类型：桌面壁纸（imgpc）或手机壁纸（sp）
- **默认值**：imgpc（桌面壁纸）
- **可选值**：
  - **桌面壁纸**（imgpc）：适用于电脑桌面的壁纸
  - **手机壁纸**（sp）：适用于手机屏幕的壁纸

### 排行榜周期（ranking_period）

- **类型**：选项（options）
- **描述**：选择要爬取的排行榜周期：日榜、周榜、月榜或年榜
- **默认值**：daily（日榜）
- **可选值**：
  - **日榜**（daily）：每日排行榜
  - **周榜**（weekly）：每周排行榜
  - **月榜**（monthly）：每月排行榜
  - **年榜**（annual）：每年排行榜

## 使用建议

1. **起始页面和最大页数**：建议从第1页开始，根据网络速度和需要设置合适的最大页数（最多5页）
2. **壁纸类型**：根据你的设备选择对应的壁纸类型
   - 电脑用户选择"桌面壁纸"（imgpc）
   - 手机用户选择"手机壁纸"（sp）
3. **排行榜周期**：根据你的需求选择不同的排行榜周期
   - 想要最新内容：选择"日榜"
   - 想要精选内容：选择"周榜"或"月榜"
   - 想要年度最佳：选择"年榜"

## 文件结构

```
anihonet-wallpaper/
├── manifest.json    # 插件元数据
├── config.json      # 插件配置
├── crawl.rhai       # 爬取脚本
├── doc_root/
│   └── doc.md       # 用户文档
└── README.md        # 开发文档（本文件）
```

## 打包

使用以下命令打包插件：

```bash
npm run package-plugin crawler-plugins/plugins/anihonet-wallpaper
```

打包后的文件将生成在 `crawler-plugins/packed/anihonet-wallpaper.kgpg`

楽しんで！
![img](./images/202501685-ProjectSEKAI-AkiyamaMizuki.jpg)
