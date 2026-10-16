# 哲风壁纸（haowallpaper）

从 [haowallpaper.com](https://haowallpaper.com) 按页码翻页抓取壁纸，可按标签定向搜索。

站点是 Nuxt 3 服务端渲染，列表页与详情页的信息都在首屏 HTML 里，插件直接解析，无需模拟点击。下载地址统一取详情页的 `previewFileImg`（图片约 1100px 宽的 WebP，视频为压缩后的 mp4），该地址不受访问限制。

## 配置项

- **起始页面 / 结束页数**：按页码翻页（填了标签时为搜索结果的页码），一次最多 100 页。
- **壁纸类型**：桌面壁纸（`homeView`）或手机壁纸（`mobileView`）。
- **壁纸格式**：图片、视频，可多选。只勾一种时按站点前端的规则换算成 `wpType` 定向拉取（电脑静态 `1` / 电脑动态 `3,4` / 手机静态 `2` / 手机动态 `5,6`）；两种都勾则不传，走站点默认集合。
- **标签集合**：留空则拉取全站列表；填写后走站点搜索，多个标签以「、」连接（如 `/homeView?search=动漫、二次元&sortType=3&wpType=3,4`），站点按并集返回结果。排序固定为站点默认的「昨日热门」。

## 说明

- 每张壁纸会进入其详情页，从中读取分类、分辨率、色系、大小、标签、发布时间、作者等信息写入 metadata。
- 相关标签会转换为拼音 key 后写入 `haowallpaper/tag` 标签画册（例如“二次元”→`er-ci-yuan`）；作者按站内用户 ID 写入 `haowallpaper/artist`。`tiny-pinyin` 以体积优先，不保证多音字读音准确。
- 插件 Provider 可按目录、下载量、收藏量与色彩浏览；站点标签与作者统一从应用的标签画册浏览。
- 需要登录的原图端点不在抓取范围内。

## 第三方许可

本插件内置了 [tiny-pinyin](https://github.com/creeperyang/pinyin) 1.3.2（MIT License）。

Copyright (c) 2017 Creeper

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
