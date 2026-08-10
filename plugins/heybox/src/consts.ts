// @ts-nocheck
// 端点、公共查询参数与固定请求头。改接口参数时只动这里。

export const API_HOST = "https://api.xiaoheihe.cn";
// 发评论走另一台主机（workshopapi），签名算法与 api.xiaoheihe.cn 一致。
export const COMMENT_API_HOST = "https://workshopapi.xiaoheihe.cn";

export const PATH_SEARCH = "/bbs/app/api/general/search/v1";
export const PATH_TREE = "/bbs/app/link/tree";
export const PATH_ORIGINAL = "/bbs/app/api/original/image";
export const PATH_COMMENT_CREATE = "/bbs/app/comment/create";
export const PATH_AWARD_LINK = "/bbs/app/profile/award/link";

// 官网 axios 拦截器合并的公共参数。heybox_id 留空即可（登录态由 Cookie 承载），
// 实测发评论也不需要真实值。
export const COMMON_PARAMS_BASE =
  "os_type=web&app=heybox&client_type=web&version=999.0.4&web_version=2.5&x_client_type=web&x_app=heybox_website&heybox_id=&x_os_type=Windows&device_info=Chrome";

/**
 * 发评论必须带 Referer，否则接口回 `非法的请求`。实测只有 Referer 起作用：
 * 单给 Origin 或 User-Agent 一样被拒，只给 Referer 就能过。读接口（搜索 / tree /
 * 原图）不需要，所以只在评论那一个请求上单独带，不进任务级公共头。
 */
export const COMMENT_REFERER = "https://www.xiaoheihe.cn/";

export const REQUEST_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "x-client-type": "web",
  "x-app": "heybox_website",
  "x-os-type": "Windows",
  "device-info": "Chrome",
};

/** 单帖最多快照多少条评论：既进 metadata，也是自动评论的去重范围。 */
export const COMMENTS_MAX = 120;

/**
 * 搜索接口 limit/offset 的单位不是「帖子条数」——返回的 items 里 type=link（帖子）
 * 与 type=space（版块卡）交替出现，实测恒为 links = limit / 3：
 * lim=3→1、6→2、9→3、15→5、30→10；lim=1/2 直接返回 0 条。
 * 所以按帖子条数乘这个系数换算成接口单位，offset 同理，页与页之间不重叠。
 */
export const SEARCH_UNITS_PER_POST = 3;
