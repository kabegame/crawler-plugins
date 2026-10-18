// 通用小工具：取值归一、时间、风控码判定、HTTP JSON、输入解析。
import { t } from "./i18n";
import type { VideoRef } from "./types";

const { warn } = Kabegame;

/** 单次请求附带的头。只在本次请求生效（宿主 fetch 会用 init.headers 覆盖任务默认头）。 */
export type RequestHeaders = Record<string, string>;

export function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** -101 登录态缺失 → 硬失败；-352 风控 → 告警不中断。与 bilibili 专栏插件一致。 */
export function checkBilibiliRisk(code: unknown): void {
  if (code === -101) {
    throw new Error(t("apiNotLoggedIn"));
  }
  if (code === -352) {
    warn(t("riskControl"));
  }
}

/** 保持原 `coerceStr(error?.message ?? error)` 的字符串回退语义。 */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return coerceStr(error);
}

/** 运行时给 Error 追加的 noRetry 标记：失效稿件等重试也不会变好的情形。 */
export function hasNoRetry(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { noRetry?: unknown }).noRetry);
}

/** 运行时给 Error 追加的 skipEpisode 标记：番剧会员专享集整季跳过。 */
export function hasSkipEpisode(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { skipEpisode?: unknown }).skipEpisode);
}

/**
 * headers 只在本次请求生效（宿主 fetch 会用 init.headers 覆盖任务默认头），
 * 因此调 space 这类要求不同 Referer/Origin 的接口时不必改全局头。
 */
export async function fetchJson<T = unknown>(url: string, headers?: RequestHeaders): Promise<T> {
  const response = await fetch(url, headers ? { headers } : undefined);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  // 外部 JSON 边界：结构由调用处传入的响应类型声明。
  return (await response.json()) as T;
}

// 失效稿件不会被 B 站从列表/搜索索引里摘掉，而是替换成一段占位视频：
// view 接口的 state 仍然是 0，只有标题会变。所以只能按标题识别。
const DEAD_TITLES = ["该视频已失效", "已失效视频", "视频去哪了呢"];

export function isUnavailableTitle(title: unknown): boolean {
  const text = coerceStr(title).trim();
  return DEAD_TITLES.some((dead) => text.includes(dead));
}

export function parseVideoId(raw: unknown): VideoRef {
  const work = coerceStr(raw).trim();
  const bv = work.match(/BV[0-9A-Za-z]{10}/);
  if (bv) return { bvid: bv[0], aid: "" };
  const av = work.match(/(?:^|av|\/)(\d{1,12})(?:[/?#]|$)/i);
  if (av) return { bvid: "", aid: av[1] };
  return { bvid: "", aid: "" };
}

export function parseMid(raw: unknown): string {
  const work = coerceStr(raw).trim();
  const fromUrl = work.match(/space\.bilibili\.com\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(work) ? work : "";
}
