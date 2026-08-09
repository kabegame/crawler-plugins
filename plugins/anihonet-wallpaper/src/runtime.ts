// @ts-nocheck
// Kabegame 页面桥、HTML 解析与 URL 工具。
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { currentHtml, to } = Kabegame;

export const DEFAULT_BASE_URL = "https://anihonetwallpaper.com";

export function coerceStr(value) {
  return value == null ? "" : String(value);
}

export function textOf(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function parseHtml(html) {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

export async function openDocument(url) {
  const finalUrl = await to(url);
  return { finalUrl, document: parseHtml(await currentHtml()) };
}

export function resolveUrl(url, base) {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
}

export function isImageUrl(url) {
  return /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(coerceStr(url));
}
