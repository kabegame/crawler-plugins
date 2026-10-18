// 缩略图 -> 原图：走 /bbs/app/api/original/image 换链，换不到时回退成去掉 query 的原输入。
import { API_HOST, PATH_ORIGINAL } from "./consts";
import { t } from "./i18n";
import { signedUrl } from "./sign";
import {
  challengeError,
  coerceStr,
  fetchJson,
  isChallenge,
  log,
  stripUrlQuery,
  validHttpUrl,
} from "./util";

/** 原图接口的最小响应结构（外部 JSON，字段都可能缺失）。 */
type XhhOriginalResponse = {
  status?: unknown;
  result?: {
    imgs?: string | unknown[] | null;
  } | null;
};

function firstOriginalUrl(originalResponse: XhhOriginalResponse, fallbackInput: unknown): string {
  const imgs = originalResponse?.result?.imgs;
  let finalUrl = "";
  if (typeof imgs === "string") {
    finalUrl = imgs;
  } else if (Array.isArray(imgs) && imgs.length > 0) {
    finalUrl = coerceStr(imgs[0]);
  }
  if (!validHttpUrl(finalUrl)) {
    const fallback = stripUrlQuery(fallbackInput);
    if (validHttpUrl(fallback)) finalUrl = fallback;
  }
  return validHttpUrl(finalUrl) ? finalUrl : "";
}

/** 换原图；失败返回空串（调用方跳过这张图，不中断整个帖子）。 */
export async function resolveOriginalUrl(
  inputUrl: string,
  commonParams: string,
  where: string,
): Promise<string> {
  const origExtra = `url=${encodeURIComponent(inputUrl)}`;
  const origUrl = signedUrl(API_HOST, PATH_ORIGINAL, commonParams, origExtra);
  const orig = await fetchJson<XhhOriginalResponse>(origUrl);
  if (isChallenge(orig?.status)) challengeError(where, orig?.status);
  if (orig?.status !== "ok") {
    log(t("originalRequestFailed", { where, status: coerceStr(orig?.status) }), "warn");
    return "";
  }
  return firstOriginalUrl(orig, inputUrl);
}
