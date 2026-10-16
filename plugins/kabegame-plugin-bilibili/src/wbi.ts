// @ts-nocheck
// WBI 签名核心。与 bilibili-video 插件同源（同一套 nav mixin key）；
// 各业务模块自己拼参数，这里只提供 signUrl 与密钥获取。
import { md5 } from "@kabegame/plugin-sdk";

import { MIXIN_TAB, NAV_URL } from "./consts";
import { checkBilibiliRisk, coerceStr, fetchJson } from "./util";

const { delHeader, setHeader } = Kabegame;

function wbiFilterValue(value) {
  return coerceStr(value).replace(/[!'()*]/g, "");
}

function getMixinKey(orig) {
  return MIXIN_TAB.map((idx) => orig[idx] || "").join("").slice(0, 32);
}

function stemFromWbiUrl(url) {
  const name = coerceStr(url).split("/").pop() || "";
  return name.split(".", 1)[0] || "";
}

/** pairs 是 [key, value] 数组，按传入顺序签名（调用方负责排序约定）。 */
export function signUrl(baseUrl, pairs, img, sub) {
  const mix = getMixinKey(`${img}${sub}`);
  const q = pairs.map(([key, value]) => `${key}=${encodeURIComponent(wbiFilterValue(value))}`).join("&");
  return `${baseUrl}?${q}&w_rid=${md5(q + mix)}`;
}

export async function getWbiKeys() {
  delHeader("Referer");
  setHeader("Referer", "https://www.bilibili.com/");
  const nav = await fetchJson(NAV_URL);
  delHeader("Referer");
  if (nav?.code !== 0) {
    checkBilibiliRisk(nav?.code);
    throw new Error(`nav 接口异常: ${coerceStr(nav?.message)}`);
  }
  const wbi = nav?.data?.wbi_img || {};
  const keys = { img: stemFromWbiUrl(wbi.img_url), sub: stemFromWbiUrl(wbi.sub_url) };
  if (!keys.img || !keys.sub) throw new Error("无法从 nav 获取 WBI 密钥");
  return keys;
}
