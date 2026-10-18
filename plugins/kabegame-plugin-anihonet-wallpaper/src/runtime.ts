// Kabegame 页面桥、HTML 解析与 URL 工具。
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { currentHtml, to } = Kabegame;

export const DEFAULT_BASE_URL = "https://anihonetwallpaper.com";

export function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

export function textOf(el: Element | null | undefined): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function parseHtml(html: unknown): Document {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

export async function openDocument(url: string): Promise<{ finalUrl: string; document: Document }> {
  const finalUrl = await to(url);
  return { finalUrl, document: parseHtml(await currentHtml()) };
}

export function resolveUrl(url: unknown, base: string): string {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
}

export function isImageUrl(url: unknown): boolean {
  return /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(coerceStr(url));
}
