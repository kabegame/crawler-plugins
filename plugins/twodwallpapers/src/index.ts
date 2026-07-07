// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { addProgress, currentHtml, downloadImage, to, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://2dwallpapers.com";

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function textOf(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function parseHtml(html) {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

async function openDocument(url) {
  const finalUrl = await to(url);
  return { finalUrl, document: parseHtml(await currentHtml()) };
}

function resolveUrl(url, base) {
  const raw = coerceStr(url).trim();
  return raw ? resolveSdkUrl(raw, base) : "";
}

function matchesPattern(pattern, text) {
  const p = coerceStr(pattern).trim();
  if (!p) return false;
  try {
    return new RegExp(p, "i").test(coerceStr(text));
  } catch {
    return coerceStr(text).toLowerCase().includes(p.toLowerCase());
  }
}

function isUncategorizedKey(workKey) {
  const q = coerceStr(workKey).trim();
  return !q || /^(uncategorized|uncategorised|未分类|未分類)$/i.test(q);
}

function parsePageNumFromUrl(url) {
  const match = coerceStr(url).match(/\/page\/(\d+)(?:\?.*)?$/);
  return match ? Number(match[1]) : 0;
}

function parseTotalPagesFromPagination(document) {
  let maxPage = 1;
  for (const anchor of Array.from(document.querySelectorAll(".page-link"))) {
    const hrefPage = parsePageNumFromUrl(anchor.getAttribute("href"));
    if (hrefPage > maxPage) maxPage = hrefPage;
    const textPage = Number(textOf(anchor));
    if (Number.isInteger(textPage) && textPage > maxPage) maxPage = textPage;
  }
  return maxPage;
}

function buildPageUrl(listUrl, pageNum) {
  if (pageNum <= 1) return listUrl;
  const [baseRaw, query = ""] = listUrl.split("?");
  const base = baseRaw.replace(/\/$/, "");
  return `${base}/page/${pageNum}${query ? `?${query}` : ""}`;
}

async function processDetailPage(href, pageUrl) {
  const detailUrl = resolveUrl(href, pageUrl);
  const { document, finalUrl } = await openDocument(detailUrl);
  const image = document.querySelector(".bip-download-btn")?.getAttribute("href") || "";
  if (!image) {
    warn("[twodwallpapers] 详情页未找到下载链接，跳过");
    return;
  }

  const titleRaw = textOf(document.querySelector(".post-title"));
  let name = titleRaw.replace(/\s*Wallpaper\s+ID\d+\s*$/i, "").trim() || titleRaw;
  const wallpaperId = titleRaw.match(/Wallpaper\s+ID(\d+)\s*$/i)?.[1] || "";
  const pageNum = finalUrl.match(/\/([^/]+)\.html(?:\?.*)?$/)?.[1] || "";
  const category = textOf(document.querySelector(".meta-cat-dot a"));
  const sidebarText = textOf(document.querySelector("#block-9"));
  const resolution = sidebarText.match(/Resolution:\s*([^\n\r]+)/i)?.[1]?.trim() || "";
  const size = sidebarText.match(/Size:\s*([^\n\r]+)/i)?.[1]?.trim() || "";
  const fileFormat = sidebarText.match(/Format:\s*([^\n\r]+)/i)?.[1]?.trim() || "";
  const downloadUrl = resolveUrl(image, finalUrl);
  const metadata = {
    name,
    wallpaper_id: wallpaperId,
    page_num: pageNum,
    detail_url: finalUrl,
    resolution,
    size,
    format: fileFormat,
    category,
    download_url: downloadUrl,
  };
  const opts = { metadata, url: finalUrl };
  if (name) opts.name = name;
  await downloadImage(downloadUrl, opts);
}

async function findWorkEntry(baseUrl, workKey) {
  const q = coerceStr(workKey).trim();
  if (isUncategorizedKey(q)) {
    const href = `${baseUrl}/uncategorized`;
    console.log(`命中未分类目录，直接抓取分页列表: ${href}`);
    return { label: "Uncategorized", href, category: "uncategorized" };
  }

  for (const category of ["game-wallpapers", "anime-wallpapers"]) {
    const categoryUrl = `${baseUrl}/${category}`;
    console.log(`查找作品「${q}」：打开目录页 ${categoryUrl}`);
    const { document, finalUrl } = await openDocument(categoryUrl);
    for (const anchor of Array.from(document.querySelectorAll(".filter-link > a"))) {
      const label = textOf(anchor);
      const href = resolveUrl(anchor.getAttribute("href"), finalUrl);
      if (matchesPattern(q, label) || matchesPattern(q, href)) {
        console.log(`命中作品「${label}」: ${href}`);
        return { label, href, category };
      }
    }
    console.log(`目录 ${category} 未找到作品「${q}」，继续查找下一个目录`);
  }
  throw new Error(`未找到匹配作品: ${q}`);
}

async function crawlMatchedSubcategory(label, listUrl, startPage, endPage, pctBudget) {
  console.log(`匹配作品「${label}」: ${listUrl}`);
  let { document } = await openDocument(listUrl);
  const siteTotalPages = parseTotalPagesFromPagination(document);
  const requestedPages = endPage - startPage + 1;
  const actualEndPage = Math.min(endPage, siteTotalPages);
  const pctPerRequestedPage = requestedPages > 0 ? pctBudget / requestedPages : 0.0;
  let processedPages = 0;

  if (startPage > siteTotalPages) {
    console.log(`起始页 ${startPage} 超出站点总页数 ${siteTotalPages}，跳过该作品并补足进度`);
    addProgress(pctBudget);
    return;
  }

  for (let pageIdx = startPage; pageIdx <= actualEndPage; pageIdx += 1) {
    const pageUrl = buildPageUrl(listUrl, pageIdx);
    if (pageIdx > 1 || pageUrl !== listUrl) {
      console.log(`处理第 ${pageIdx}/${siteTotalPages} 页：${pageUrl}`);
      document = (await openDocument(pageUrl)).document;
    }

    const imageLinks = Array.from(document.querySelectorAll(".media-img"))
      .map((a) => a.getAttribute("href") || "")
      .filter(Boolean);
    const pctPerImage = imageLinks.length > 0
      ? pctPerRequestedPage / imageLinks.length
      : pctPerRequestedPage;
    console.log(`列表第 ${pageIdx}/${siteTotalPages} 页: 媒体链接 ${imageLinks.length} 个，逐个进入详情下载`);

    for (const imageLink of imageLinks) {
      await processDetailPage(imageLink, pageUrl);
      addProgress(pctPerImage);
    }
    if (imageLinks.length === 0) addProgress(pctPerRequestedPage);
    processedPages += 1;
  }

  const missingPages = requestedPages - processedPages;
  if (missingPages > 0 && pctPerRequestedPage > 0.0) {
    addProgress(pctPerRequestedPage * missingPages);
  }
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = common?.baseUrl || DEFAULT_BASE_URL;
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  const orderby = coerceStr(vars.orderby || "date");
  if (endPage < startPage) throw new Error("结束页数需要大于或等于起始页数");

  console.log("[twodwallpapers] 开始爬取");
  const work = await findWorkEntry(baseUrl, vars.work_key);
  const listUrl = `${work.href}?orderby=${encodeURIComponent(orderby)}`;
  await crawlMatchedSubcategory(work.label, listUrl, startPage, endPage, 100.0);
  console.log("[twodwallpapers] 爬取结束");
}
