// @ts-nocheck
// 排行榜 URL 拼装与分页抓取。
import { processDetailPage } from "./detail";
import { openDocument, resolveUrl } from "./runtime";

const { addProgress } = Kabegame;

function rankingListSlug(period, category) {
  const slugCategory = category === "img-pc" ? "imgpc" : category;
  return slugCategory === "all" ? `ranking-${period}` : `ranking-${period}-${slugCategory}`;
}

export async function crawlKind(kind, startPage, endPage, period, baseUrl) {
  const totalPages = endPage - startPage + 1;
  const pctPerPage = totalPages > 0 ? 100.0 / totalPages : 0.0;
  const slug = rankingListSlug(period, kind);
  for (let page = startPage; page <= endPage; page += 1) {
    const pageUrl = page === 1 ? `${baseUrl}/${slug}` : `${baseUrl}/${slug}/${page}`;
    const { document, finalUrl } = await openDocument(pageUrl);
    const hrefs = Array.from(document.querySelectorAll("article .ranking-frame a[href]"))
      .map((anchor) => resolveUrl(anchor.getAttribute("href"), finalUrl))
      .filter(Boolean);
    if (hrefs.length === 0) {
      addProgress(pctPerPage);
      continue;
    }
    const pctPerItem = pctPerPage / hrefs.length;
    for (let idx = 0; idx < hrefs.length; idx += 1) {
      await processDetailPage(hrefs[idx], pctPerItem, idx + 1, hrefs.length, finalUrl);
    }
  }
}
