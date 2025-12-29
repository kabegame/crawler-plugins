# anihonet 动漫壁纸 - 插件说明

本插件用于从 `anihonetwallpaper.com` 的每日排行抓取壁纸并加入下载队列。

## 关键规则（手机/桌面判定）

- **手机壁纸**：图片 URL 的**文件名**（URL 最后一个路径段）包含 `Android`（忽略大小写）
- **桌面壁纸**：不包含 `Android`

> 例：`xxx_Android_xxx.jpg` 会被视为手机壁纸；`xxx_PC_xxx.jpg` 会被视为桌面壁纸。

## 配置项

- **起始页面（start_page）**：从第几页开始抓取
- **最大页数（max_pages）**：抓取到第几页为止
- **壁纸类型（wallpaper_type）**：
  - 勾选 `desktop`：只下载“桌面壁纸”
  - 勾选 `mobile`：只下载“手机壁纸”
  - 两者都勾选：两种都下载

## 使用建议

- 如果你只想要手机壁纸：只勾选 `mobile`
- 如果你只想要桌面壁纸：只勾选 `desktop`