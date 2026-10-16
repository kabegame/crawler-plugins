// @ts-nocheck
// 端点与常量。改接口参数时只动这里。所有端点均经畅游登录态 Cookie 实测可用。

export const BASE = "https://weibo.com";
export const PROFILE_INFO_API = `${BASE}/ajax/profile/info`;
// 用户相册（图片墙）：since_id 游标；返回 list[{pid, mid, type, video}]
export const IMAGE_WALL_API = `${BASE}/ajax/profile/getImageWall`;
// 用户时间线：page 递增；feature 0=全部 1=原创 2=图片
export const MYMBLOG_API = `${BASE}/ajax/statuses/mymblog`;
export const SHOW_API = `${BASE}/ajax/statuses/show`;
export const LONGTEXT_API = `${BASE}/ajax/statuses/longtext`;
export const COMMENTS_API = `${BASE}/ajax/statuses/buildComments`;
// 超话 feed：必须带 X-Requested-With，否则 403（code 303403）；翻页参数在 moreInfo.params
export const SUPERTOPIC_API = `${BASE}/ajax_proxy/chaohua/page`;
// 关键词搜索只有 HTML（s.weibo.com），只从中抽 mid，再逐条走 SHOW_API 拿结构化数据
export const SEARCH_URL = "https://s.weibo.com/weibo";
// s.weibo.com 最多 50 页，第 51 页起会回绕到前面的结果
export const SEARCH_MAX_PAGE = 50;

// 超话 id = 100808 + md5(超话名)
export const SUPERTOPIC_PREFIX = "100808";
// 超话频道：内置排序的后缀；标签频道（如「同人」）的 flowId 需从 channelInfo.channels 按标题查
export const SUPERTOPIC_SORTS = {
  hot: "_-_recommend",
  latest: "_-_sort_time",
  reply: "_-_feed",
  soul: "_-_soul",
};

export const TIMELINE_FEATURES = { all: 0, original: 1, pic: 2 };

// 请求间隔（毫秒），登录态下连续请求过快可能触发 418
export const PAGE_DELAY_MS = 800;
export const POST_DELAY_MS = 400;
