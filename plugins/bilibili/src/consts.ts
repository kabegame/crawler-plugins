// @ts-nocheck
// 端点、常量表。改接口参数时只动这里。

export const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
export const SEARCH_API = "https://api.bilibili.com/x/web-interface/wbi/search/type";
export const VIEW_API = "https://api.bilibili.com/x/article/view";
export const REPLY_API = "https://api.bilibili.com/x/v2/reply/wbi/main";
// 图文流接口（gallery-dl BilibiliAPI 同源）：space 按 UP 主翻页，fav 是登录用户自己的图文收藏。
export const OPUS_FEED_SPACE_API = "https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/feed/space";
export const OPUS_FEED_FAV_API = "https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/feed/fav";
// 动态详情接口：相册型图文的 live_url 只在这里下发（HTML INITIAL_STATE 的 album.pics 缺失该字段），
// 必须带 features=itemOpusStyle，否则 major 是不含 live_url 的旧 draw 结构。
export const OPUS_DETAIL_API = "https://api.bilibili.com/x/polymer/web-dynamic/v1/detail";

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** WBI mixin key 换位表，来自 B 站前端 getMixinKey()。 */
export const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];
