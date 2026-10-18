// pixiv 各模式共用：请求头、登录态、JSON 请求与进度。
import { t } from "./i18n";

const { addProgress, requireCookie, setHeader } = Kabegame;

// 配置字段来自 GUI（可能有类型）或 CLI --var（一定是字符串），统一按 unknown 收窄。
export type PixivVars = {
  source?: unknown;
  user_id?: unknown;
  num_artworks?: unknown;
  keyword?: unknown;
  keyword_order?: unknown;
  search_mode?: unknown;
  ranking_mode?: unknown;
  content_mode?: unknown;
  age_mode?: unknown;
  ranking_date?: unknown;
  artist_id?: unknown;
  artist_start_page?: unknown;
  artist_end_page?: unknown;
  third_party_api?: unknown;
  lolicon_count?: unknown;
  lolicon_r18?: unknown;
  lolicon_tags?: unknown;
  lolicon_uids?: unknown;
  lolicon_orientation?: unknown;
  lolicon_exclude_ai?: unknown;
  lolicon_date_after?: unknown;
  lolicon_date_before?: unknown;
};

export function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

// 本任务是否已从畅游注入 pixiv Cookie；togglePixivHeaders(true) 据此重新注入。
let pixivCookieInjected = false;

// 需要登录态的分支：从畅游注入 pixiv 的 Cookie（脚本拿不到明文）。
// 取不到（畅游无该站 Cookie）直接抛错终止任务，提示用户先去畅游登录 pixiv。
export function ensurePixivCookie(reason: string): void {
  if (!requireCookie()) {
    throw new Error(t("loginRequired", { reason }));
  }
  pixivCookieInjected = true;
}

// fetchJson 抛出的 HTTP 错误带状态码；403 用于判定登录态失效。
function statusOf(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    return typeof error.status === "number" ? error.status : null;
  }
  return null;
}

// 需登录分支中，列表请求得到 403 视为登录态失效 → 抛错终止（提示重新登录）。
// 其它错误交回调用方按原逻辑处理（通常是到底/瞬时错误后 break）。
export function rethrowIfLoginFailed(error: unknown, reason: string, loginRequired: boolean): void {
  if (loginRequired && statusOf(error) === 403) {
    throw new Error(t("loginExpired", { reason }));
  }
}

export function setPixivHeaders(): void {
  setHeader(
    "User-Agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  );
  setHeader("Referer", "https://www.pixiv.net/");
  setHeader("Origin", "https://www.pixiv.net");
  setHeader("x-requested-with", "XMLHttpRequest");
  setHeader("Accept", "application/json");
}

// 任务请求头对 fetch 全局生效。请求第三方 API 前关掉 pixiv 的来源头与登录 Cookie：
// lolicon 见到任何 Referer / Origin 都返回 403，Cookie 则会把 pixiv 登录态发给第三方。
// 置空即可关闭；打开时恢复 pixiv 请求头，Cookie 明文脚本拿不到，只能向畅游重新注入。
export function togglePixivHeaders(on: boolean): void {
  if (on) {
    setPixivHeaders();
    if (pixivCookieInjected) requireCookie();
    return;
  }
  setHeader("Referer", "");
  setHeader("Origin", "");
  setHeader("Cookie", "");
}

// 调用处按接口响应类型传泛型；JSON 解析结果在 fetch 边界收窄。
export async function fetchJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const err = Object.assign(new Error(`HTTP ${response.status}: ${url}`), {
      status: response.status,
    });
    throw err;
  }
  return (await response.json()) as T;
}

export function addArtworkProgress(totalArtworks: number): void {
  if (totalArtworks > 0) addProgress(99.0 / totalArtworks);
}
