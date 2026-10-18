// 站内关键词搜索与分页抓取。
import { processDetailPage } from "./detail";
import { coerceStr, openDocument, resolveUrl, textOf } from "./runtime";
import { t } from "./i18n";

const { addProgress, warn } = Kabegame;

function positivePage(value: unknown, fallback: number): number {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) && page >= 1 ? page : fallback;
}

function normalizeOrder(value: unknown): string {
  return coerceStr(value).toUpperCase() === "ASC" ? "ASC" : "DESC";
}

function normalizeOrderBy(value: unknown): string {
  return coerceStr(value) === "rand" ? "rand" : "post_date";
}

function searchPageUrl(
  baseUrl: string,
  query: string,
  order: string,
  orderBy: string,
  page: number,
): string {
  const root = coerceStr(baseUrl).replace(/\/+$/, "");
  const path = page > 1 ? `/page/${page}` : "/";
  return `${root}${path}?s=${encodeURIComponent(query)}&order=${order}&orderby=${orderBy}`;
}

function collectSearchDetailHrefs(document: Document, pageUrl: string): string[] {
  return Array.from(document.querySelectorAll(".post_box .posttitle a[href]"))
    .map((anchor) => resolveUrl(anchor.getAttribute("href"), pageUrl))
    .filter(Boolean);
}

function parseSearchTotalPages(document: Document): number {
  const text = textOf(document.querySelector(".post_box2 .center"));
  const match = text.match(/\d+\s*\/\s*(\d+)/);
  const pages = match ? Number(match[1]) : 1;
  return pages > 0 ? pages : 1;
}

export async function crawlSearch(
  queryValue: unknown,
  orderValue: unknown,
  orderByValue: unknown,
  pageStart: number,
  pageEnd: number,
  baseUrl: string,
): Promise<void> {
  const query = coerceStr(queryValue).trim();
  if (!query) {
    warn(t("searchQueryEmpty"));
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
    t("searchStart", {
      query,
      order,
      orderBy,
      requestedRange,
      actualRange,
    }),
  );
  if (start > totalPages || end > totalPages) {
    warn(t("rangeNotCovered", { actualRange, requestedRange }));
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
    console.log(t("searchPageOpen", { page, total: totalPages, count: detailHrefs.length, url: finalUrl }));
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
