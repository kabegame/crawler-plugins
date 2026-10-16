// @ts-nocheck
// 通用小工具：宿主桥接（日志 / 请求头 / 登录提示）、取值归一、文本清洗、风控判定、HTTP JSON。
import { REQUEST_HEADERS } from "./consts";

const { createImageMetadata: createImageMetadataRow, setHeader, warn } = Kabegame;

// 本次任务是否成功从畅游注入了 Cookie（用于失败时给出登录提示）
let cookieAvailable = false;

export function setCookieAvailable(value) {
  cookieAvailable = !!value;
}

/** 未登录时给告警补一句去畅游登录的提示；已登录返回空串。 */
export function loginHint() {
  return cookieAvailable ? "" : "（当前未登录，请先在畅游登录小黑盒后重试）";
}

export function setRequestHeaders() {
  for (const [key, value] of Object.entries(REQUEST_HEADERS)) {
    setHeader(key, value);
  }
}

export function log(message, level) {
  if (level === "warn") {
    warn(String(message ?? ""));
    return;
  }
  console.log(String(message ?? ""));
}

export const createImageMetadata = (metadata) =>
  Number(createImageMetadataRow(metadata, null));

export function coerceStr(value) {
  return value == null ? "" : String(value);
}

export function stripTags(html) {
  return coerceStr(html).replace(/<[^>]*>/g, "");
}

export function stripUrlQuery(url) {
  return coerceStr(url).split("?", 1)[0];
}

export function stripEmojiBracketTokens(value) {
  return coerceStr(value)
    .replace(/\[[a-z]+_[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function validHttpUrl(url) {
  return /^https?:\/\//i.test(coerceStr(url));
}

export function extractLinkId(shareUrl) {
  if (!shareUrl) return "";
  const match = String(shareUrl).match(/[?&]link_id=([^&#]+)/);
  return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
}

export function isChallenge(status) {
  const s = String(status ?? "");
  return s === "show_captcha" || s === "need_verify" || s.includes("captcha");
}

export function challengeError(where, status) {
  throw new Error(
    `${where} status=${status ?? "nil"}。已触发小黑盒风控/验证码，请切换网络或代理 IP 后重试。`,
  );
}

export async function fetchJson(url) {
  return (await fetch(url)).json();
}
