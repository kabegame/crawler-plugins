// @ts-nocheck
// WBI 签名。算法照搬 yt-dlp `BilibiliBaseIE._get_wbi_key` / `_sign_wbi`
// （ignore/yt-dlp/yt_dlp/extractor/bilibili.py），与 bilibili 专栏插件同源。
import { md5 } from "@kabegame/plugin-sdk";

import { MIXIN_TAB, NAV_API } from "./consts";
import { coerceStr, fetchJson } from "./util";

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

/** params 是普通对象；按 key 排序后签名（对应 yt-dlp 的 `sorted(params.items())`）。 */
export function signQuery(baseUrl, params, img, sub) {
  const mix = getMixinKey(`${img}${sub}`);
  const query = Object.keys(params)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(wbiFilterValue(params[key]))}`)
    .join("&");
  return `${baseUrl}?${query}&w_rid=${md5(query + mix)}`;
}

export async function getWbiKeys() {
  const nav = await fetchJson(NAV_API);
  // nav 未登录时返回 code -101，但 wbi_img 照样下发，所以这里不当作错误。
  const wbi = nav?.data?.wbi_img || {};
  const keys = { img: stemFromWbiUrl(wbi.img_url), sub: stemFromWbiUrl(wbi.sub_url) };
  if (!keys.img || !keys.sub) throw new Error("无法从 nav 获取 WBI 密钥");
  return { keys, isLoggedIn: nav?.data?.isLogin === true };
}

/**
 * 播放器反爬指纹参数。来源见 yt-dlp bilibili.py `_dm_params`
 * （逆向自 bili-user-fingerprint.min.js）。鼠标轨迹相关的 dm_img_list 留空即可放行。
 */
export function buildDmParams() {
  const printable = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!\"#$%&'()*+,-./:;<=>?@[]^_`{|}~";
  const randChars = (len) => {
    let out = "";
    for (let i = 0; i < len; i += 1) {
      out += printable[Math.floor(Math.random() * printable.length)];
    }
    return out;
  };
  const b64 = (text) => btoa(text).slice(0, -2);
  const rnd = Math.floor(514 * Math.random());
  return {
    dm_img_list: "[]",
    dm_img_str: b64(randChars(16 + Math.floor(Math.random() * 49))),
    dm_cover_img_str: b64(randChars(32 + Math.floor(Math.random() * 97))),
    // 必须是紧凑 JSON（无空格），B 站按字符串校验。
    dm_img_inter: JSON.stringify({
      ds: [],
      wh: [1920, 1080, 18],
      of: [3 * 10 + 2 * 10 + rnd, 4 * 10 - 4 * 10 + 2 * rnd, rnd],
    }),
  };
}
