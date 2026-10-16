// @ts-nocheck
// 小黑盒 Web 端请求签名：规范化路径 + 秒级 _time + 随机 nonce -> hkey。
// 与官网打包脚本（xhh.js）一致，算法细节见 items-api.md 第 3 节；
// 自测脚本在 scripts/xhh-sign-test.mjs。
import { md5 } from "@kabegame/plugin-sdk";

const XHH_CHARSET = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";

function mapStringWithCharset(value, charsetLength) {
  const pool = Array.from(XHH_CHARSET.slice(0, charsetLength));
  return Array.from(value)
    .map((char) => pool[char.charCodeAt(0) % pool.length])
    .join("");
}

function normalizePath(urlOrPath) {
  const trimmed = String(urlOrPath || "").trim();
  const pathOnly = trimmed.includes("://")
    ? trimmed.slice(trimmed.indexOf("://") + 3).replace(/^[^/]*/, "") || "/"
    : trimmed;
  const withoutQuery = pathOnly.split("?", 1)[0] || "/";
  const segments = withoutQuery.split("/").filter(Boolean);
  return `/${segments.join("/")}/`;
}

function interleaveColumnMajor(parts) {
  const chars = parts.map((part) => Array.from(part));
  const maxLength = Math.max(...chars.map((part) => part.length), 0);
  let out = "";
  for (let row = 0; row < maxLength; row += 1) {
    for (const part of chars) {
      if (row < part.length) out += part[row];
    }
  }
  return out;
}

const gfVm = (value) => (value & 128 ? 255 & ((value << 1) ^ 27) : value << 1);
const gfQm = (value) => gfVm(value) ^ value;
const gfSm = (value) => gfQm(gfVm(value));
const gfYm = (value) => gfSm(gfQm(gfVm(value)));
const gfGm = (value) => gfYm(value) ^ gfSm(value) ^ gfQm(value);

/** 对 4 字节做一轮类 AES MixColumns 的变换（bundle 内同名逻辑）。 */
function mixFourBytesInPlace(values) {
  const t0 = gfGm(values[0]) ^ gfYm(values[1]) ^ gfSm(values[2]) ^ gfQm(values[3]);
  const t1 = gfQm(values[0]) ^ gfGm(values[1]) ^ gfYm(values[2]) ^ gfSm(values[3]);
  const t2 = gfSm(values[0]) ^ gfQm(values[1]) ^ gfGm(values[2]) ^ gfYm(values[3]);
  const t3 = gfYm(values[0]) ^ gfSm(values[1]) ^ gfQm(values[2]) ^ gfGm(values[3]);
  values[0] = t0;
  values[1] = t1;
  values[2] = t2;
  values[3] = t3;
}

function xhhNonce(t) {
  return md5(`${Math.trunc(t)}${Math.random()}`).toUpperCase();
}

function xhhHkey(path, t, nonce) {
  const pathNorm = normalizePath(path);
  const tInner = Math.trunc(t) + 1;
  const partA = mapStringWithCharset(String(tInner), XHH_CHARSET.length - 2);
  const partB = mapStringWithCharset(pathNorm, XHH_CHARSET.length);
  const partC = mapStringWithCharset(nonce, XHH_CHARSET.length);
  const interleaved = interleaveColumnMajor([partA, partB, partC]).slice(0, 20);
  const md5Hex = md5(interleaved);
  const last6Codes = Array.from(md5Hex.slice(-6)).map((char) => char.charCodeAt(0));
  mixFourBytesInPlace(last6Codes);
  const twoDigit = String(last6Codes.reduce((sum, value) => sum + value, 0) % 100).padStart(2, "0");
  const prefix = mapStringWithCharset(md5Hex.slice(0, 5), XHH_CHARSET.length - 4);
  return `${prefix}${twoDigit}`;
}

export function xhhFakeDeviceId() {
  return xhhNonce(Date.now() / 1000).toLowerCase();
}

/** 拼出带签名的完整 URL；`extra` 为业务参数，可省略（发评论时参数在 body 里）。 */
export function signedUrl(apiHost, path, commonParams, extra) {
  const t = Math.floor(Date.now() / 1000);
  const nonce = xhhNonce(t);
  const hkey = xhhHkey(path, t, nonce);
  const sign = `hkey=${hkey}&_time=${t}&nonce=${nonce}`;
  return `${apiHost}${path}?${commonParams}&${sign}${extra ? `&${extra}` : ""}`;
}
