// @ts-nocheck
// 站内关键词搜索与分页抓取。
import { processDetailPage } from "./detail";
import { coerceStr, openDocument, resolveUrl, textOf } from "./runtime";

const { addProgress, warn } = Kabegame;

function positivePage(value, fallback) {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) && page >= 1 ? page : fallback;
}

function normalizeOrder(value) {
  return coerceStr(value).toUpperCase() === "ASC" ? "ASC" : "DESC";
}

function normalizeOrderBy(value) {
  return coerceStr(value) === "rand" ? "rand" : "post_date";
}

function searchPageUrl(baseUrl, query, order, orderBy, page) {
  const root = coerceStr(baseUrl).replace(/\/+$/, "");
  const path = page > 1 ? `/page/${page}` : "/";
  return `${root}${path}?s=${encodeURIComponent(query)}&order=${order}&orderby=${orderBy}`;
}

function collectSearchDetailHrefs(document, pageUrl) {
  return Array.from(document.querySelectorAll(".post_box .posttitle a[href]"))
    .map((anchor) => resolveUrl(anchor.getAttribute("href"), pageUrl))
    .filter(Boolean);
}

function parseSearchTotalPages(document) {
  const text = textOf(document.querySelector(".post_box2 .center"));
  const match = text.match(/\d+\s*\/\s*(\d+)/);
  const pages = match ? Number(match[1]) : 1;
  return pages > 0 ? pages : 1;
}

export async function crawlSearch(queryValue, orderValue, orderByValue, pageStart, pageEnd, baseUrl) {
  const query = coerceStr(queryValue).trim();
  if (!query) {
    warn("[anihonet] 搜索关键词为空，未发起站内搜索");
    addProgress(100.0);
    return;
  }

  const order = normalizeOrder(orderValue);
  const orderBy = normalizeOrderBy(orderByValue);
  let start = positivePage(pageStart, 1);
  let end = positivePage(pageEnd, 1);
  if (start > end) [start, end] = [end, start];

  const firstUrl = searchPageUrl(baseUrl, query, order, orderBy, 1);
  let { document, finalUrl } = await openDocument(firstUrl);
  const totalPages = parseSearchTotalPages(document);
  const requestedRange = `${start}-${end}`;
  const actualRange = `1-${totalPages}`;
  console.log(
    `[anihonet] 站内搜索 关键词=${query} 方向=${order} 排序=${orderBy} 页数范围参数=${requestedRange}，检测到的实际页数范围=${actualRange}`,
  );
  if (start > totalPages || end > totalPages) {
    warn(`[anihonet] 检测到的实际页数范围 ${actualRange} 未覆盖输入范围 ${requestedRange}，超出部分不会抓取`);
  }
  if (start > totalPages) {
    addProgress(100.0);
    return;
  }

  end = Math.min(end, totalPages);
  const pageCount = end - start + 1;
  const pctPerPage = 100.0 / pageCount;
  for (let page = start; page <= end; page += 1) {
    if (page !== 1) {
      ({ document, finalUrl } = await openDocument(searchPageUrl(baseUrl, query, order, orderBy, page)));
    }
    const detailHrefs = collectSearchDetailHrefs(document, finalUrl);
    console.log(`[anihonet] 搜索结果第 ${page}/${totalPages} 页，详情页 ${detailHrefs.length} 条: ${finalUrl}`);
    if (detailHrefs.length === 0) {
      addProgress(pctPerPage);
      continue;
    }
    const workPct = pctPerPage / detailHrefs.length;
    for (let index = 0; index < detailHrefs.length; index += 1) {
      await processDetailPage(detailHrefs[index], workPct, index + 1, detailHrefs.length, finalUrl);
    }
  }
}
