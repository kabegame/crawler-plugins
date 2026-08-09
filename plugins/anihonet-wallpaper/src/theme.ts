// @ts-nocheck
// 从作品标题一览页检索主题并调度作品列表抓取。
import { coerceStr, openDocument, resolveUrl, textOf } from "./runtime";
import { crawlAnimeSeries } from "./series";

const { addProgress } = Kabegame;

function findThemeListHref(document, themeQuery, pageUrl) {
  const q = coerceStr(themeQuery).trim();
  if (!q) return "";
  for (const anchor of Array.from(
    document.querySelectorAll("div.post-list li > a[href], div.post-list a[href]"),
  )) {
    if (textOf(anchor).includes(q)) return resolveUrl(anchor.getAttribute("href"), pageUrl);
  }
  return "";
}

export async function crawlThemeFromIndex(themeQuery, pageStart, pageEnd, baseUrl) {
  const indexUrl = `${baseUrl}/anime-game-wallpaper`;
  const { document, finalUrl } = await openDocument(indexUrl);
  const href = findThemeListHref(document, themeQuery, finalUrl);
  if (!href) {
    addProgress(100.0);
    return;
  }
  await crawlAnimeSeries(href, 100.0, "theme", 1, 1, pageStart, pageEnd, finalUrl);
}
