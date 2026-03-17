# anihonet 动漫壁纸 - 插件说明

本插件用于从 `anihonetwallpaper.com` 的每日排行抓取壁纸并加入下载队列。

## 关键规则（手机/桌面判定）

- **手机壁纸**：图片 URL 的**文件名**（URL 最后一个路径段）包含 `Android`（忽略大小写）
- **桌面壁纸**：不包含 `Android`

> 例：`xxx_Android_xxx.jpg` 会被视为手机壁纸；`xxx_PC_xxx.jpg` 会被视为桌面壁纸。

## 配置项

- **起始页面（start_page）**：从第几页开始抓取（取值范围：1-5）
- **结束页数（end_page）**：抓取到第几页为止（取值范围：1-5）
- **壁纸类型（wallpaper_type）**：单选，可选「桌面壁纸」（imgpc）或「手机壁纸」（sp）
- **排行榜周期（ranking_period）**：单选，可选日榜（daily）、周榜（weekly）、月榜（monthly）、年榜（annual）

## 使用建议

- 只想要手机壁纸：壁纸类型选「手机壁纸」
- 只想要桌面壁纸：壁纸类型选「桌面壁纸」

楽しんで～
![image](./image.jpg)
