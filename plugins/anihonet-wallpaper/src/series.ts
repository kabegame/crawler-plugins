// @ts-nocheck
// 作品列表分页与单作品抓取。
import { processDetailPage } from "./detail";
import { openDocument, resolveUrl, textOf } from "./runtime";

const { addProgress } = Kabegame;

function collectDetailPageHrefs(document, pageUrl) {
  return Array.from(document.querySelectorAll(".itiran:last-of-type > a[href]"))
    .map((anchor) => resolveUrl(anchor.getAttribute("href"), pageUrl))
    .filter(Boolean);
}

function parseListPageTotalPages(document) {
  const text = textOf(document.querySelector(".post_box2 .center"));
  const match = text.match(/\d+\s*\/\s*(\d+)/);
  const n = match ? Number(match[1]) : 1;
  return n > 0 ? n : 1;
}

export async function crawlAnimeSeries(
  seriesHref,
  themePctBudget,
  rowId,
  idxInRow,
  totalInRow,
  userStart,
  userEnd,
  baseUrl,
) {
  const full = resolveUrl(seriesHref, baseUrl);
  console.log(`[anihonet] 进入作品列表页 行=${rowId} 第${idxInRow}/${totalInRow} 个分类: ${full}`);
  let { document, finalUrl } = await openDocument(full);
  const listTotalPages = parseListPageTotalPages(document);
  let start = Math.max(1, Number(userStart || 1));
  let end = Number(userEnd || 0);
  const rangeMode = end > 0;
  if (rangeMode && start > end) [start, end] = [end, start];
  const pageSpan = Math.max(1, rangeMode ? end - start + 1 : listTotalPages);
  const pctPerListPage = themePctBudget / pageSpan;
  let pageIdx = 1;
  let completed = 0;

  while (true) {
    if (rangeMode && pageIdx > end) break;
    const shouldProcess = !rangeMode || (pageIdx >= start && pageIdx <= end);
    if (shouldProcess) {
      const detailHrefs = collectDetailPageHrefs(document, finalUrl);
      if (detailHrefs.length === 0) {
        addProgress(pctPerListPage);
      } else {
        const workPct = pctPerListPage / detailHrefs.length;
        for (let idx = 0; idx < detailHrefs.length; idx += 1) {
          await processDetailPage(detailHrefs[idx], workPct, idx + 1, detailHrefs.length, finalUrl);
        }
      }
      completed += 1;
    }
    if (rangeMode && pageIdx >= end) break;
    const nextHref = document.querySelector(".post_box2 .p-next a")?.getAttribute("href") || "";
    if (!nextHref) break;
    const nextFull = resolveUrl(nextHref, finalUrl);
    ({ document, finalUrl } = await openDocument(nextFull));
    pageIdx += 1;
  }

  const used = pctPerListPage * (rangeMode ? completed : pageIdx);
  const remainder = themePctBudget - used;
  if (remainder > 0.0001) addProgress(remainder);
}
