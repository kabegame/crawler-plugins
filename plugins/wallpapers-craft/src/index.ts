// @ts-nocheck
import { resolveUrl as resolveSdkUrl } from "@kabegame/plugin-sdk";

const { addProgress, currentHtml, downloadImage, to } = Kabegame;

const DEFAULT_BASE_URL = "https://wallpaperscraft.com";

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

function getSelectedRes(vars) {
  if (vars.res_type === "none") return "";
  if (vars.res_type === "mobile") return coerceStr(vars.res_mobile);
  if (vars.res_type === "apple") return coerceStr(vars.res_apple);
  if (vars.res_type === "fullscreen") return coerceStr(vars.res_fullscreen);
  if (vars.res_type === "widescreen") return coerceStr(vars.res_widescreen);
  return "";
}

function buildPageUrl(vars, baseUrl, page, selectedRes) {
  const basePath = vars.mode === "tag"
    ? (coerceStr(vars.tag).trim()
      ? `${baseUrl}/tag/${encodeURIComponent(coerceStr(vars.tag).trim())}`
      : `${baseUrl}/all`)
    : `${baseUrl}/catalog/${vars.category}`;
  const sortPath = vars.orderby === "default" ? "" : `/${vars.orderby}`;
  const resPath = selectedRes ? `/${selectedRes}` : "";
  return `${basePath}${sortPath}${resPath}/page${page}`;
}

function getMaxPage(document) {
  const href = document.querySelector("li.pager__item:last-of-type > a")?.getAttribute("href") || "";
  const match = href.match(/(?:^|\/)page(\d+)(?:[/?#]|$)/);
  return match ? Number(match[1]) : 1;
}

function infoTextForThumb(infoTexts, idx) {
  const metaIndex = idx * 2;
  if (metaIndex < infoTexts.length) return infoTexts[metaIndex];
  return idx < infoTexts.length ? infoTexts[idx] : "";
}

function extractRes(infoText) {
  return coerceStr(infoText).match(/\b\d+x\d+\b/)?.[0] || "";
}

function makeFullUrl(thumbUrl, res) {
  return coerceStr(thumbUrl).replace(/_\d+x\d+/, `_${res}`);
}

function displayNameFromWallpaperTitle(titleRaw) {
  const title = coerceStr(titleRaw).trim();
  return title.startsWith("Wallpaper ") ? title.slice(10).trim() : title;
}

function detailItemTextMap(document) {
  const out = {};
  const cells = Array.from(document.querySelectorAll(".wallpaper-table .wallpaper-table__cell"))
    .map(textOf);
  for (let i = 0; i + 1 < cells.length; i += 2) {
    out[cells[i]] = cells[i + 1];
  }
  return out;
}

function fetchDetailMetadata(document, detailUrl, baseUrl) {
  const title = textOf(document.querySelector(".content-main h1.gui-heading"));
  let author = "";
  let license = "";
  for (const row of Array.from(document.querySelectorAll(".author .author__row"))) {
    const text = textOf(row);
    if (text.startsWith("Author:")) author = text.slice(7).trim();
    if (text.startsWith("License:")) license = text.slice(8).trim();
  }

  const sourceHref = document.querySelector(".author__block_source a.author__link")?.getAttribute("href") || "";
  const table = detailItemTextMap(document);
  const originalDownloadHref = document.querySelector(".wallpaper-table a[href*='/download/']")?.getAttribute("href") || "";

  return {
    site_base: baseUrl,
    detail_url: detailUrl,
    wallpaper_title: title,
    author,
    license,
    source_url: resolveUrl(sourceHref, detailUrl),
    rating: textOf(document.querySelector(".wallpaper-votes__rate")),
    votes_total: textOf(document.querySelector(".JS-Vote-Total")),
    original_resolution: table["Original Resolution"] || "",
    original_download_url: resolveUrl(originalDownloadHref, detailUrl),
    views: table.Views || "",
    uploaded: table.Uploaded || "",
  };
}

async function downloadWithDetail(fullUrl, detailRel, pageUrl, baseUrl) {
  const detailAbs = resolveUrl(detailRel, pageUrl);
  if (!detailAbs) {
    await downloadImage(fullUrl);
    return;
  }

  const { document } = await openDocument(detailAbs);
  const metadata = fetchDetailMetadata(document, detailAbs, baseUrl);
  const name = displayNameFromWallpaperTitle(metadata.wallpaper_title);
  const opts = { metadata, url: detailAbs };
  if (name) opts.name = name;
  await downloadImage(fullUrl, opts);
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = common?.baseUrl || DEFAULT_BASE_URL;
  const startPage = Number(vars.start_page ?? 1);
  const endPage = Number(vars.end_page ?? startPage);
  if (endPage < startPage) throw new Error("结束页数需要大于或等于起始页数");

  const selectedRes = getSelectedRes(vars);
  console.log("[wallpapers-craft] 开始爬取");
  const startUrl = buildPageUrl(vars, baseUrl, startPage, selectedRes);
  let { document } = await openDocument(startUrl);

  const maxPage = getMaxPage(document);
  const actualEndPage = Math.min(endPage, maxPage);
  if (startPage > maxPage) throw new Error(`起始页 ${startPage} 超出网站最大页 ${maxPage}`);
  const totalPages = actualEndPage - startPage + 1;

  for (let page = startPage; page <= actualEndPage; page += 1) {
    const pageUrl = buildPageUrl(vars, baseUrl, page, selectedRes);
    if (page > startPage) {
      console.log(`翻页: ${page}/${actualEndPage} -> ${pageUrl}`);
      document = (await openDocument(pageUrl)).document;
    }

    const thumbnailSrcs = Array.from(document.querySelectorAll(".wallpapers__link img"))
      .map((img) => img.getAttribute("src") || "")
      .filter(Boolean);
    const detailHrefs = Array.from(document.querySelectorAll(".wallpapers__link"))
      .map((a) => a.getAttribute("href") || "");
    const infoTexts = Array.from(document.querySelectorAll(".wallpapers__link .wallpapers__info"))
      .map(textOf);
    const pageProgress = totalPages > 0 ? 100.0 / totalPages : 0.0;
    const perImageProgress = thumbnailSrcs.length > 0 ? pageProgress / thumbnailSrcs.length : pageProgress;

    console.log(`第 ${page} 页: 缩略图 ${thumbnailSrcs.length} 张，开始处理下载`);
    for (let idx = 0; idx < thumbnailSrcs.length; idx += 1) {
      const finalRes = selectedRes || extractRes(infoTextForThumb(infoTexts, idx));
      if (finalRes) {
        const fullUrl = makeFullUrl(thumbnailSrcs[idx], finalRes);
        await downloadWithDetail(fullUrl, detailHrefs[idx] || "", pageUrl, baseUrl);
      }
      addProgress(perImageProgress);
    }
    if (thumbnailSrcs.length === 0) addProgress(pageProgress);
  }

  console.log("[wallpapers-craft] 爬取结束");
}
