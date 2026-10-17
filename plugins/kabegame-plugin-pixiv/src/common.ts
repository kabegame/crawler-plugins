// @ts-nocheck
// pixiv 各模式共用：请求头、登录态、JSON 请求与进度。
import { t } from "./i18n";

const { addProgress, requireCookie, setHeader } = Kabegame;

export function coerceStr(value) {
  return value == null ? "" : String(value);
}

// 本任务是否已从畅游注入 pixiv Cookie；togglePixivHeaders(true) 据此重新注入。
let pixivCookieInjected = false;

// 需要登录态的分支：从畅游注入 pixiv 的 Cookie（脚本拿不到明文）。
// 取不到（畅游无该站 Cookie）直接抛错终止任务，提示用户先去畅游登录 pixiv。
export function ensurePixivCookie(reason) {
  if (!requireCookie()) {
    throw new Error(t("loginRequired", { reason }));
  }
  pixivCookieInjected = true;
}

// 需登录分支中，列表请求得到 403 视为登录态失效 → 抛错终止（提示重新登录）。
// 其它错误交回调用方按原逻辑处理（通常是到底/瞬时错误后 break）。
export function rethrowIfLoginFailed(error, reason, loginRequired) {
  if (loginRequired && error?.status === 403) {
    throw new Error(t("loginExpired", { reason }));
  }
}

export function setPixivHeaders() {
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
export function togglePixivHeaders(on) {
  if (on) {
    setPixivHeaders();
    if (pixivCookieInjected) requireCookie();
    return;
  }
  setHeader("Referer", "");
  setHeader("Origin", "");
  setHeader("Cookie", "");
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}: ${url}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

export function addArtworkProgress(totalArtworks) {
  if (totalArtworks > 0) addProgress(99.0 / totalArtworks);
}

