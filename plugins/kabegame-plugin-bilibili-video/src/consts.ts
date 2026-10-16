// @ts-nocheck
// 端点、常量表。改接口参数时只动这里。

export const NAV_API = "https://api.bilibili.com/x/web-interface/nav";
export const VIEW_API = "https://api.bilibili.com/x/web-interface/view";
export const PLAYURL_API = "https://api.bilibili.com/x/player/wbi/playurl";
export const SPACE_API = "https://api.bilibili.com/x/space/wbi/arc/search";
export const SEASON_API = "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list";
export const SERIES_API = "https://api.bilibili.com/x/series/archives";
export const FAV_LIST_API = "https://api.bilibili.com/x/v3/fav/resource/list";
export const FAV_IDS_API = "https://api.bilibili.com/x/v3/fav/resource/ids";
export const SEARCH_API = "https://api.bilibili.com/x/web-interface/wbi/search/type";
export const BANGUMI_SEASON_API = "https://api.bilibili.com/pgc/view/web/season";
export const BANGUMI_PLAYURL_API = "https://api.bilibili.com/pgc/player/web/v2/playurl";
export const BANGUMI_MEDIA_API = "https://api.bilibili.com/pgc/review/user";

export const WEB_BASE = "https://www.bilibili.com";
export const SPACE_BASE = "https://space.bilibili.com";

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** DASH + 全格式位掩码（yt-dlp `_download_playinfo`）。 */
export const FNVAL_DASH = 4048;

/** 番剧 playurl 的 fnval（yt-dlp `BiliBiliBangumiIE`：12240 = DASH + HDR + 4K + 杜比 + 8K）。 */
export const FNVAL_BANGUMI = 12240;

/** Range 分块大小。8 MiB 在吞吐和常驻内存之间比较平衡。 */
export const CHUNK_SIZE = 8 * 1024 * 1024;

/** UP 主投稿接口的每页条数。 */
export const SPACE_PAGE_SIZE = 30;

/** 合集 / 系列接口的每页条数；收藏夹不分页，借它换算 offset。 */
export const LIST_PAGE_SIZE = 30;

/** 搜索接口的每页条数。 */
export const SEARCH_PAGE_SIZE = 20;

/** WBI mixin key 换位表，来自 B 站前端 getMixinKey()。 */
export const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];
