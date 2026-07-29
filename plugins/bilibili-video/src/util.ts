// @ts-nocheck
// 通用小工具：取值归一、时间、风控码判定、HTTP JSON、输入解析。

const { warn } = Kabegame;

export function coerceStr(value) {
  return value == null ? "" : String(value);
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** -101 登录态缺失 → 硬失败；-352 风控 → 告警不中断。与 bilibili 专栏插件一致。 */
export function checkBilibiliRisk(code) {
  if (code === -101) {
    throw new Error("B 站接口返回未登录（-101）：未获取到有效登录态，请先在畅游登录 bilibili 后重试。");
  }
  if (code === -352) {
    warn("B 站接口触发风控（-352），可稍后重试或更换网络；若持续失败请在畅游重新登录 bilibili。");
  }
}

/**
 * headers 只在本次请求生效（宿主 fetch 会用 init.headers 覆盖任务默认头），
 * 因此调 space 这类要求不同 Referer/Origin 的接口时不必改全局头。
 */
export async function fetchJson(url, headers) {
  const response = await fetch(url, headers ? { headers } : undefined);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

// 失效稿件不会被 B 站从列表/搜索索引里摘掉，而是替换成一段占位视频：
// view 接口的 state 仍然是 0，只有标题会变。所以只能按标题识别。
const DEAD_TITLES = ["该视频已失效", "已失效视频", "视频去哪了呢"];

export function isUnavailableTitle(title) {
  const text = coerceStr(title).trim();
  return DEAD_TITLES.some((dead) => text.includes(dead));
}

export function parseVideoId(raw) {
  const work = coerceStr(raw).trim();
  const bv = work.match(/BV[0-9A-Za-z]{10}/);
  if (bv) return { bvid: bv[0], aid: "" };
  const av = work.match(/(?:^|av|\/)(\d{1,12})(?:[/?#]|$)/i);
  if (av) return { bvid: "", aid: av[1] };
  return { bvid: "", aid: "" };
}

export function parseMid(raw) {
  const work = coerceStr(raw).trim();
  const fromUrl = work.match(/space\.bilibili\.com\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(work) ? work : "";
}
